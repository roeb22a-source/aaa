import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { ROOT, UPLOAD_DIR, getConfig, saveConfig, publicConfig, hasEbayApp, isDemoAi, isDemoPublish, ebayConnected } from './config.js';
import { AppError, truncateTitle } from './util.js';
import { enhanceImage, toAnalysisJpeg } from './images.js';
import { generateListing, identify, demoListing } from './ai.js';
import { EbayError } from './ebay/http.js';
import { buildAuthUrl, checkState, exchangeCode, disconnect } from './ebay/auth.js';
import { searchComparables, categorySuggestions } from './ebay/browse.js';
import { loadPolicies, isOptedIn, optIn } from './ebay/account.js';
import { uploadImage } from './ebay/media.js';
import {
  CONDITIONS, buildInventoryItem, buildOfferPayload, createLocation, createOffer, listLocations, listingUrl, makeSku, publishOffer, putInventoryItem,
} from './ebay/inventory.js';

const ID_RE = /^[a-f0-9]{16}$/;
const MAX_PHOTOS = 6;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/files', express.static(UPLOAD_DIR, { maxAge: '1h', fallthrough: false, index: false }));
  app.use(express.static(path.join(ROOT, 'public')));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: MAX_PHOTOS },
    fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  });

  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const file = (id, suffix) => path.join(UPLOAD_DIR, `${id}${suffix}`);
  const checkId = (id) => {
    if (!ID_RE.test(String(id))) throw new AppError(400, 'Ungültiges Bild', 'Das Bild konnte nicht gefunden werden. Bitte lade es erneut hoch.', { schritt: 1 });
    return id;
  };
  const readOr = async (p) => fs.readFile(p).catch(() => null);

  // ---------- Status & Einstellungen ----------
  app.get('/api/status', (req, res) => {
    const cfg = getConfig();
    res.json({
      demoKi: isDemoAi(),
      demoEbay: isDemoPublish(),
      ebayApp: hasEbayApp(),
      ebayVerbunden: ebayConnected(),
      umgebung: cfg.ebayEnv,
      modell: cfg.claudeModel,
      zustaende: CONDITIONS,
      maxFotos: MAX_PHOTOS,
      callbackHinweis: `${process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`}/auth/ebay/callback`,
    });
  });

  app.get('/api/config', (req, res) => res.json(publicConfig()));
  app.post('/api/config', (req, res) => {
    const b = req.body || {};
    saveConfig(b, Array.isArray(b.loeschen) ? b.loeschen : []);
    res.json(publicConfig());
  });

  app.get('/auth/ebay/start', (req, res) => {
    const url = buildAuthUrl();
    if (!url) return res.redirect('/#einstellungen?fehler=' + encodeURIComponent('Bitte zuerst App ID und RuName speichern.'));
    res.redirect(url);
  });
  app.get('/auth/ebay/callback', h(async (req, res) => {
    const { code, state, error_description: errDesc, error } = req.query;
    if (error || !code) return res.redirect('/#einstellungen?fehler=' + encodeURIComponent(String(errDesc || 'eBay-Anmeldung abgebrochen.')));
    if (state && !checkState(String(state))) return res.redirect('/#einstellungen?fehler=' + encodeURIComponent('Anmeldung abgelaufen. Bitte erneut auf "Mit eBay verbinden" klicken.'));
    try {
      await exchangeCode(String(code));
      res.redirect('/#einstellungen?ebay=ok');
    } catch (e) {
      const ex = e instanceof EbayError ? e.explained.text : e.message;
      res.redirect('/#einstellungen?fehler=' + encodeURIComponent(ex));
    }
  }));
  app.post('/api/ebay/code', h(async (req, res) => {
    await exchangeCode(req.body?.code);
    res.json(publicConfig());
  }));
  app.post('/api/ebay/trennen', (req, res) => {
    disconnect();
    res.json(publicConfig());
  });

  // ---------- Fotos ----------
  app.post('/api/upload', upload.array('fotos', MAX_PHOTOS), h(async (req, res) => {
    const out = [];
    for (const f of req.files || []) {
      const id = crypto.randomBytes(8).toString('hex');
      try {
        const buf = await sharp(f.buffer, { failOn: 'none' }).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
        await fs.writeFile(file(id, '.jpg'), buf);
        out.push({ id, url: `/files/${id}.jpg`, name: f.originalname });
      } catch {
        out.push({ fehler: `"${f.originalname}" konnte nicht gelesen werden (nur JPG, PNG, WebP; iPhone-Fotos im Format "HEIC" bitte in den Kameraeinstellungen auf "Kompatibel" stellen).` });
      }
    }
    if (!out.length) throw new AppError(400, 'Keine Bilder', 'Es wurde kein gültiges Bild übertragen.');
    res.json({ bilder: out });
  }));

  app.delete('/api/upload/:id', h(async (req, res) => {
    const id = checkId(req.params.id);
    await Promise.all(['.jpg', '.enh.jpg', '.mask.png'].map((s) => fs.rm(file(id, s), { force: true })));
    res.json({ ok: true });
  }));

  app.post('/api/enhance', h(async (req, res) => {
    const id = checkId(req.body?.id);
    const blur = Number.isFinite(Number(req.body?.blur)) ? Number(req.body.blur) : 50;
    const orig = await readOr(file(id, '.jpg'));
    if (!orig) throw new AppError(404, 'Bild nicht gefunden', 'Das Foto wurde nicht gefunden (evtl. automatisch gelöscht). Bitte lade es in Schritt 1 erneut hoch.', { schritt: 1 });
    const cachedMask = await readOr(file(id, '.mask.png'));
    const r = await enhanceImage(orig, { blur, cachedMask });
    await fs.writeFile(file(id, '.enh.jpg'), r.buffer);
    if (r.maskPng) await fs.writeFile(file(id, '.mask.png'), r.maskPng);
    res.json({ id, original: `/files/${id}.jpg`, verbessert: `/files/${id}.enh.jpg?v=${Date.now()}`, methode: r.method, hinweis: r.note || null });
  }));

  // ---------- KI ----------
  async function imageBuffers(bilder) {
    if (!Array.isArray(bilder) || bilder.length < 1 || bilder.length > MAX_PHOTOS) throw new AppError(400, 'Fotos fehlen', 'Bitte wähle 1 bis 6 Fotos aus.', { schritt: 1 });
    const bufs = [];
    for (const b of bilder) {
      const id = checkId(b.id);
      const raw = (b.variante === 'verbessert' && (await readOr(file(id, '.enh.jpg')))) || (await readOr(file(id, '.jpg')));
      if (!raw) throw new AppError(404, 'Bild nicht gefunden', 'Ein Foto wurde nicht gefunden. Bitte lade es in Schritt 1 erneut hoch.', { schritt: 1 });
      bufs.push(raw);
    }
    return bufs;
  }

  async function market(query) {
    const out = { vergleich: null, kategorien: [], warnungen: [] };
    if (!hasEbayApp() || !query) return out;
    const [c, k] = await Promise.allSettled([searchComparables(query), categorySuggestions(query)]);
    if (c.status === 'fulfilled') out.vergleich = c.value;
    else out.warnungen.push('Vergleichsangebote konnten nicht geladen werden: ' + (c.reason?.explained?.text || c.reason?.message));
    if (k.status === 'fulfilled') out.kategorien = k.value;
    else out.warnungen.push('Kategorie-Vorschläge nicht verfügbar: ' + (k.reason?.explained?.text || k.reason?.message));
    return out;
  }

  app.post('/api/analyze', h(async (req, res) => {
    const { bilder, stichworte = '', vorher = null, hinweis = '', vergleich = null } = req.body || {};
    const bufs = await imageBuffers(bilder);
    const jpgs = await Promise.all(bufs.map((b) => toAnalysisJpeg(b)));
    const neu = Boolean(vorher);

    let m = { vergleich, kategorien: null, warnungen: [] };
    if (!neu) {
      let query = stichworte.trim();
      if (!query && !isDemoAi() && hasEbayApp()) query = await identify(jpgs).catch(() => '');
      m = await market(query);
    }

    const listing = isDemoAi()
      ? demoListing(stichworte, m.vergleich, neu ? Math.floor(Math.random() * 3) : 0)
      : await generateListing({ imageBuffers: jpgs, keywords: stichworte, comparables: m.vergleich, previous: vorher, hint: hinweis });

    if (!neu && !m.kategorien.length && !isDemoAi() && hasEbayApp() && (listing.suchbegriff || listing.artikel)) {
      const k = await categorySuggestions(listing.suchbegriff || listing.artikel).catch(() => []);
      m.kategorien = k;
    }
    if (!neu && isDemoPublish() && !m.kategorien.length) {
      m.kategorien = [{ id: '0', name: 'Beispielkategorie (Demo)', pfad: 'Demo > Beispielkategorie' }];
    }
    res.json({ ergebnis: listing, vergleich: m.vergleich, kategorien: m.kategorien, warnungen: m.warnungen, demo: isDemoAi() });
  }));

  // ---------- Konto: Richtlinien & Standort ----------
  const DEMO_POLICIES = {
    versand: [
      { id: 'demo-v1', name: 'Paket DHL (Demo)', abholung: false },
      { id: 'demo-v2', name: 'Nur Abholung (Demo)', abholung: true },
    ],
    zahlung: [{ id: 'demo-z1', name: 'eBay-Zahlungsabwicklung (Demo)' }],
    rueckgabe: [{ id: 'demo-r1', name: 'Keine Rücknahme (Demo)' }, { id: 'demo-r2', name: '14 Tage Rückgabe (Demo)' }],
    standorte: [{ key: 'demo-standort', name: 'Mein Standort (Demo)', ort: '10115 Berlin' }],
    demo: true,
  };
  let demoLocations = null;

  app.get('/api/konto', h(async (req, res) => {
    if (isDemoPublish()) {
      demoLocations ||= DEMO_POLICIES.standorte;
      return res.json({ ...DEMO_POLICIES, standorte: demoLocations });
    }
    if (!(await isOptedIn())) return res.json({ optInNoetig: true, versand: [], zahlung: [], rueckgabe: [], standorte: [] });
    const [p, l] = await Promise.allSettled([loadPolicies(), listLocations()]);
    if (p.status === 'rejected') throw p.reason;
    res.json({ ...p.value, standorte: l.status === 'fulfilled' ? l.value : [], demo: false });
  }));
  app.post('/api/konto/optin', h(async (req, res) => {
    if (!isDemoPublish()) await optIn();
    res.json({ ok: true });
  }));
  app.post('/api/standort', h(async (req, res) => {
    const { plz, ort, land = 'DE' } = req.body || {};
    if (!/^\d{4,5}$/.test(String(plz || '')) || !String(ort || '').trim()) throw new AppError(400, 'Standort unvollständig', 'Bitte gib eine gültige Postleitzahl und einen Ort an.');
    if (isDemoPublish()) {
      demoLocations = [{ key: 'demo-standort', name: 'Mein Standort (Demo)', ort: `${plz} ${ort}` }];
      return res.json({ key: 'demo-standort' });
    }
    res.json({ key: await createLocation({ plz: String(plz), ort: String(ort).trim(), land }) });
  }));

  // ---------- Einstellen ----------
  app.post('/api/einstellen', h(async (req, res) => {
    const draft = req.body || {};
    const v = draft.verkauf || {};
    if (!draft.titel?.trim()) throw new AppError(400, 'Titel fehlt', 'Bitte gib in Schritt 3 einen Titel ein.', { schritt: 3 });
    if (!draft.beschreibung?.trim()) throw new AppError(400, 'Beschreibung fehlt', 'Bitte gib in Schritt 3 eine Beschreibung ein.', { schritt: 3 });
    draft.titel = truncateTitle(draft.titel, 80);
    const bufs = await imageBuffers(draft.bilder);

    if (isDemoPublish()) {
      buildOfferPayload(draft, { sku: 'DEMO', policies: { versand: 'x', zahlung: 'x', rueckgabe: 'x' }, merchantLocationKey: 'x', categoryId: draft.kategorieId || '0' });
      await new Promise((r) => setTimeout(r, 1200));
      const listingId = String(Math.floor(1e11 + Math.random() * 9e11));
      return res.json({ demo: true, listingId, url: `https://www.ebay.de/itm/${listingId}`, sku: 'DEMO' });
    }

    if (!draft.kategorieId) throw new AppError(400, 'Kategorie fehlt', 'Bitte wähle in Schritt 3 eine eBay-Kategorie aus (oder trage die Kategorie-Nummer ein).', { schritt: 3 });
    if (!v.versandId || !v.zahlungId || !v.rueckgabeId) throw new AppError(400, 'Richtlinien fehlen', 'Bitte wähle in Schritt 4 Versand-, Zahlungs- und Rückgaberichtlinie aus.', { schritt: 4 });
    if (!v.standort) throw new AppError(400, 'Standort fehlt', 'Bitte wähle in Schritt 4 einen Standort aus oder lege einen an.', { schritt: 4 });

    const sku = makeSku();
    const offer = buildOfferPayload(draft, {
      sku,
      policies: { versand: v.versandId, zahlung: v.zahlungId, rueckgabe: v.rueckgabeId },
      merchantLocationKey: v.standort,
      categoryId: draft.kategorieId,
    });
    const urls = [];
    for (let i = 0; i < bufs.length; i++) urls.push(await uploadImage(bufs[i], `bild${i + 1}.jpg`));
    await putInventoryItem(sku, buildInventoryItem(draft, urls));
    const offerId = await createOffer(offer);
    const listingId = await publishOffer(offerId);
    res.json({ demo: false, listingId, url: listingUrl(listingId), sku, offerId });
  }));

  // ---------- Fehlerbehandlung ----------
  app.use('/api', (req, res) => res.status(404).json({ fehler: { titel: 'Nicht gefunden', text: 'Diese Funktion gibt es nicht.' } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof EbayError) {
      const x = err.explained;
      console.error('[eBay]', err.status, JSON.stringify(err.errors).slice(0, 500));
      return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ fehler: { ...x, details: err.errors.map((e) => e.message || e.longMessage).filter(Boolean).join(' | ') } });
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({ fehler: { titel: err.titel, text: err.text, schritt: err.schritt, einstellungen: err.einstellungen } });
    }
    if (err instanceof multer.MulterError) {
      const text = err.code === 'LIMIT_FILE_SIZE' ? 'Ein Foto ist zu groß (maximal 20 MB).' : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? 'Es sind höchstens 6 Fotos erlaubt.' : 'Das Hochladen hat nicht geklappt.';
      return res.status(400).json({ fehler: { titel: 'Upload-Problem', text } });
    }
    if (err.statusCode === 404 || err.status === 404) return res.status(404).json({ fehler: { titel: 'Nicht gefunden', text: 'Datei nicht gefunden.' } });
    console.error(err);
    res.status(500).json({ fehler: { titel: 'Unerwarteter Fehler', text: 'Etwas ist schiefgelaufen. Bitte versuche es noch einmal.' } });
  });

  return app;
}

export async function cleanupUploads(hours = Number(process.env.CLEANUP_HOURS) || 48) {
  const limit = Date.now() - hours * 3600_000;
  let n = 0;
  for (const f of await fs.readdir(UPLOAD_DIR).catch(() => [])) {
    const p = path.join(UPLOAD_DIR, f);
    const st = await fs.stat(p).catch(() => null);
    if (st?.isFile() && st.mtimeMs < limit) {
      await fs.rm(p, { force: true });
      n++;
    }
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  cleanupUploads();
  setInterval(cleanupUploads, 3600_000).unref();
  createApp().listen(port, () => {
    console.log(`eBay-Verkaufshelfer läuft: http://localhost:${port}`);
    console.log(`Modus: KI ${isDemoAi() ? 'DEMO' : 'echt'}, eBay ${isDemoPublish() ? 'DEMO' : getConfig().ebayEnv}`);
  });
}
