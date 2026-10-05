// eBay-Verkaufshelfer - Frontend (Vanilla JS, keine Abhängigkeiten)
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STEPS = ['Fotos', 'Bilder verbessern', 'Text & Preis', 'Verkaufsart', 'Vorschau & Einstellen'];
const STORE_KEY = 'ebayhelfer-entwurf-v1';
const MAX = 6;

const freshState = () => ({
  schritt: 1,
  bilder: [], // {id, url, wahl:'verbessert'|'original', verbessert, methode, hinweis}
  blur: 50,
  stichworte: '',
  privat: true,
  text: null, // {titel, beschreibung, zustand, zustandsbeschreibung, merkmale[], preis_festpreis, preis_startpreis, preis_begruendung, hinweise[]}
  vergleich: null,
  kategorien: [],
  kategorieId: '',
  warnungen: [],
  verkauf: { art: 'festpreis', preis: '', startpreis: '', sofortpreis: '', reservePreis: '', dauerTage: 7, menge: 1, preisvorschlag: { aktiv: false, annahmeAb: '', ablehnenUnter: '' }, versandId: '', zahlungId: '', rueckgabeId: '', standort: '' },
});

let state = freshState();
let status = { demoKi: true, demoEbay: true, zustaende: {} };
let konto = null; // Antwort von /api/konto
let kontoFehler = null;
let busy = null; // Text, wenn etwas läuft
let ergebnis = null; // Ergebnis des Einstellens {url, ...} oder {fehler}

// ---------- Speicher (localStorage, immer mit try/catch) ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* privater Modus o. ä. */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      state = { ...freshState(), ...s, verkauf: { ...freshState().verkauf, ...(s.verkauf || {}), preisvorschlag: { ...freshState().verkauf.preisvorschlag, ...(s.verkauf?.preisvorschlag || {}) } } };
      return state.bilder.length > 0 || Boolean(state.text);
    }
  } catch { /* beschädigt: ignorieren */ }
  return false;
}
function themeInit() {
  try {
    const t = localStorage.getItem('ebayhelfer-theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch { /* ignorieren */ }
}
$('#themeBtn').addEventListener('click', () => {
  const dark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#0f141b';
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ebayhelfer-theme', next); } catch { /* ignorieren */ }
});

// ---------- Hilfsfunktionen ----------
async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw Object.assign(new Error('Keine Verbindung zum Programm. Läuft es noch?'), { fehler: { titel: 'Keine Verbindung', text: 'Das Programm antwortet nicht. Prüfe, ob "npm start" noch läuft.' } });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.fehler?.text || 'Fehler'), { fehler: data?.fehler || { titel: 'Fehler', text: 'Unbekannter Fehler.' } });
  return data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}
const help = (text) => `<button type="button" class="help" data-help="${esc(text)}" aria-label="Hilfe anzeigen" aria-expanded="false">?</button>`;
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const eur = (v) => (Number.isFinite(num(v)) ? num(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '-');
const errBox = (f) =>
  `<div class="notice err" role="alert"><b>${esc(f.titel || 'Fehler')}</b>${esc(f.text || '')}${f.details ? `<div class="muted">Technische Details: ${esc(f.details)}</div>` : ''}
   <div class="btn-row" style="margin-top:10px">${f.schritt ? `<button class="btn btn-primary btn-small" data-go="${f.schritt}">Zurück zu Schritt ${f.schritt}</button>` : ''}${f.einstellungen ? `<a class="btn btn-primary btn-small" href="#einstellungen">Zu den Einstellungen</a>` : ''}</div></div>`;
const spinner = (t) => `<div class="busy" role="status"><span class="spinner"></span><span>${esc(t)}</span></div>`;
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}

// ---------- Rahmen: Banner, Fortschritt, Navigation ----------
function renderBanner() {
  const parts = [];
  if (status.demoKi) parts.push('DEMO: Text wird als Beispiel erzeugt (kein Anthropic-Schlüssel hinterlegt)');
  if (status.demoEbay) parts.push('DEMO: Einstellen wird nur simuliert (nicht mit eBay verbunden)');
  $('#banner').innerHTML = parts.map((p) => `<div class="demo">${esc(p)}</div>`).join('');
}
function renderProgress() {
  $('#progress').innerHTML = STEPS.map((s, i) => `<div class="st ${i + 1 < state.schritt ? 'done' : i + 1 === state.schritt ? 'now' : ''}"><div class="bar"></div><span>${i + 1}. ${esc(s)}</span></div>`).join('');
}
const NEXT_LABEL = ['', 'Weiter: Bilder verbessern', 'Weiter: Text erstellen', 'Weiter: Verkaufsart', 'Weiter: Vorschau', ''];

function renderNav() {
  const nav = $('#navbar');
  const s = state.schritt;
  nav.classList.toggle('hidden', Boolean(ergebnis?.url) || location.hash.startsWith('#einstellungen'));
  $('#backBtn').classList.toggle('hide', s === 1);
  $('#nextBtn').classList.toggle('hide', s === 5);
  $('#nextBtn').textContent = NEXT_LABEL[s];
  $('#nextBtn').disabled = Boolean(busy);
  $('#backBtn').disabled = Boolean(busy);
}

function validate(s) {
  if (s === 1) {
    if (state.bilder.length < 1) return 'Bitte füge mindestens 1 Foto hinzu.';
    if (state.bilder.length > MAX) return 'Es sind höchstens 6 Fotos erlaubt.';
  }
  if (s === 2 && state.bilder.some((b) => !b.verbessert)) return 'Die Bilder werden noch verbessert. Bitte einen Moment warten.';
  if (s === 3) {
    if (!state.text) return 'Bitte lass zuerst den Text erstellen (grüner Knopf).';
    if (!state.text.titel.trim()) return 'Bitte gib einen Titel ein.';
    if (state.text.titel.length > 80) return 'Der Titel ist länger als 80 Zeichen.';
    if (!state.text.beschreibung.trim()) return 'Bitte gib eine Beschreibung ein.';
  }
  if (s === 4) {
    const v = state.verkauf;
    if (v.art === 'festpreis' && !(num(v.preis) > 0)) return 'Bitte gib einen Festpreis ein.';
    if (v.art !== 'festpreis' && !(num(v.startpreis) > 0)) return 'Bitte gib einen Startpreis ein.';
    if (v.art === 'auktion_sofort' && !(num(v.sofortpreis) > num(v.startpreis))) return 'Der Sofort-Kaufen-Preis muss höher als der Startpreis sein.';
    if (v.art === 'festpreis' && v.preisvorschlag.aktiv) {
      const a = num(v.preisvorschlag.annahmeAb);
      if (a > num(v.preis)) return 'Der Preis für die automatische Annahme darf nicht höher als der Festpreis sein.';
    }
    if (!v.versandId || !v.zahlungId || !v.rueckgabeId) return 'Bitte wähle Versand-, Zahlungs- und Rückgaberichtlinie aus.';
    if (!v.standort) return 'Bitte wähle einen Standort aus oder lege einen an.';
  }
  return null;
}

function go(n) {
  state.schritt = Math.max(1, Math.min(5, n));
  ergebnis = ergebnis?.url ? ergebnis : null;
  save();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#nextBtn').addEventListener('click', () => {
  const e = validate(state.schritt);
  if (e) return toast(e);
  go(state.schritt + 1);
});
$('#backBtn').addEventListener('click', () => go(state.schritt - 1));

// ---------- Rendering ----------
function render() {
  if (location.hash.startsWith('#einstellungen')) return renderSettings();
  $('#progress').classList.remove('hide');
  renderBanner();
  renderProgress();
  renderNav();
  const v = $('#view');
  ({ 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 })[state.schritt](v);
}

// ===== Schritt 1: Fotos =====
function step1(v) {
  const n = state.bilder.length;
  v.innerHTML = `
    <h1>Schritt 1: Fotos hinzufügen</h1>
    <p class="lead">Mach 1 bis 6 Fotos von deinem Artikel. Das erste Foto ist das Hauptbild. Gute Fotos verkaufen besser: helles Licht, ruhiger Hintergrund, auch Details und Mängel zeigen.</p>
    <div class="drop" id="drop">
      <p><b>Fotos hierher ziehen</b> oder:</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="camBtn" type="button">Foto aufnehmen</button>
        <button class="btn btn-secondary" id="galBtn" type="button">Aus Galerie wählen</button>
      </div>
      <p class="muted" style="margin-bottom:0">${n} von ${MAX} Fotos${n >= MAX ? ' (Maximum erreicht)' : ''}</p>
      <input type="file" id="camInput" accept="image/*" capture="environment" multiple hidden>
      <input type="file" id="galInput" accept="image/*" multiple hidden>
    </div>
    <div id="upMsg"></div>
    <div class="thumbs" id="thumbs">${state.bilder.map((b, i) => `
      <div class="thumb">
        <img class="timg" src="${esc(b.url)}" alt="Foto ${i + 1}" data-id="${b.id}">
        ${i === 0 ? '<span class="badge">Hauptbild</span>' : ''}
        <div class="tb">
          <button type="button" data-move="${i}" data-dir="-1" aria-label="Nach vorne" ${i === 0 ? 'disabled' : ''}>&#9664;</button>
          <button type="button" class="del" data-del="${b.id}" aria-label="Foto entfernen">&#10005;</button>
          <button type="button" data-move="${i}" data-dir="1" aria-label="Nach hinten" ${i === n - 1 ? 'disabled' : ''}>&#9654;</button>
        </div>
      </div>`).join('')}</div>
    ${n ? `<p style="margin-top:18px"><button class="btn btn-secondary btn-small" id="resetBtn" type="button">Alles verwerfen und neu beginnen</button></p>` : ''}`;
  const drop = $('#drop');
  $('#camBtn').onclick = () => $('#camInput').click();
  $('#galBtn').onclick = () => $('#galInput').click();
  for (const id of ['camInput', 'galInput']) $('#' + id).onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles([...(e.dataTransfer?.files || [])]));
  const rb = $('#resetBtn');
  if (rb) rb.onclick = () => resetAll();
}

async function addFiles(files) {
  files = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!files.length) return toast('Bitte wähle Bilddateien aus.');
  const room = MAX - state.bilder.length;
  if (room <= 0) return toast('Es sind höchstens 6 Fotos erlaubt.');
  let note = '';
  if (files.length > room) {
    files = files.slice(0, room);
    note = `Es wurden nur ${room} Foto(s) übernommen (Maximum 6).`;
  }
  const form = new FormData();
  files.forEach((f) => form.append('fotos', f));
  $('#upMsg').innerHTML = spinner('Fotos werden hochgeladen ...');
  try {
    const r = await api('/api/upload', { form });
    const fehler = r.bilder.filter((b) => b.fehler).map((b) => b.fehler);
    for (const b of r.bilder.filter((x) => x.id)) state.bilder.push({ id: b.id, url: b.url, wahl: 'verbessert', verbessert: null });
    save();
    step1($('#view'));
    const msgs = [note, ...fehler].filter(Boolean);
    if (msgs.length) $('#upMsg').innerHTML = `<div class="notice warn">${msgs.map(esc).join('<br>')}</div>`;
  } catch (e) {
    $('#upMsg').innerHTML = errBox(e.fehler);
  }
}

async function removeImage(id) {
  state.bilder = state.bilder.filter((b) => b.id !== id);
  save();
  api(`/api/upload/${id}`, { method: 'DELETE' }).catch(() => {});
  render();
}
function resetAll() {
  if (!confirm('Wirklich alles verwerfen? Fotos und Texte gehen verloren.')) return;
  state.bilder.forEach((b) => api(`/api/upload/${b.id}`, { method: 'DELETE' }).catch(() => {}));
  state = freshState();
  ergebnis = null;
  konto = null;
  save();
  render();
}
// Defekte Bilder (z. B. automatisch gelöscht) aus dem Entwurf entfernen
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el?.classList?.contains('timg') && el.dataset.id) {
    state.bilder = state.bilder.filter((b) => b.id !== el.dataset.id);
    save();
    toast('Ein altes Foto war nicht mehr vorhanden und wurde entfernt.');
    if (state.schritt === 1) render();
  }
}, true);

// ===== Schritt 2: Bilder verbessern =====
function step2(v) {
  const todo = state.bilder.filter((b) => !b.verbessert);
  v.innerHTML = `
    <h1>Schritt 2: Bilder verbessern</h1>
    <p class="lead">Das Programm macht deine Fotos automatisch heller und schärfer und macht den Hintergrund unscharf, damit dein Artikel besser wirkt. Tippe auf ein Bild, um zwischen Original und verbessert zu wechseln.</p>
    <div class="card">
      <label for="blur" style="margin-top:0">Stärke der Hintergrund-Unschärfe: <b id="blurVal">${state.blur}</b> ${help('0 = Hintergrund bleibt scharf. 50 = normal. 100 = sehr starke Unschärfe. Nach dem Ändern auf "Neu berechnen" tippen.')}</label>
      <input type="range" id="blur" min="0" max="100" step="5" value="${state.blur}">
      <button class="btn btn-secondary btn-small" id="recalc" type="button" ${busy ? 'disabled' : ''}>Neu berechnen</button>
    </div>
    <div id="enhBusy">${busy ? spinner(busy) : ''}</div>
    <div id="enhCards">${state.bilder.map((b, i) => enhCard(b, i)).join('')}</div>`;
  $('#blur').oninput = (e) => { state.blur = Number(e.target.value); $('#blurVal').textContent = state.blur; save(); };
  $('#recalc').onclick = () => { state.bilder.forEach((b) => (b.verbessert = null)); runEnhance(); };
  if (todo.length && !busy) runEnhance();
}
function enhCard(b, i) {
  const sel = b.wahl;
  const m = { freistellung: 'Freigestellt', 'fokus-blur': 'Fokus-Unschärfe', 'ohne-blur': 'Ohne Unschärfe' }[b.methode] || '';
  return `<div class="card tight" data-card="${b.id}">
    <div class="label" style="margin-top:0">Foto ${i + 1}${i === 0 ? ' (Hauptbild)' : ''} ${m ? `<span class="tag">${m}</span>` : ''}</div>
    ${b.verbessert ? `<div class="ba">
        <figure class="${sel === 'original' ? 'sel' : ''}" data-pick="${b.id}" data-w="original"><img src="${esc(b.url)}" alt="Original"><figcaption>Original</figcaption></figure>
        <figure class="${sel === 'verbessert' ? 'sel' : ''}" data-pick="${b.id}" data-w="verbessert"><img src="${esc(b.verbessert)}" alt="Verbessert"><figcaption>Verbessert</figcaption></figure>
      </div>
      <div class="seg" role="radiogroup" aria-label="Welche Version verwenden?">
        <label><input type="radio" name="w-${b.id}" value="original" data-wahl="${b.id}" ${sel === 'original' ? 'checked' : ''}><span>Original nehmen</span></label>
        <label><input type="radio" name="w-${b.id}" value="verbessert" data-wahl="${b.id}" ${sel === 'verbessert' ? 'checked' : ''}><span>Verbessert nehmen</span></label>
      </div>
      ${b.hinweis ? `<div class="notice info" style="margin-bottom:0">${esc(b.hinweis)}</div>` : ''}`
      : `<div class="busy"><span class="spinner"></span><span>Wartet ...</span></div>`}
  </div>`;
}
async function runEnhance() {
  if (busy) return;
  const todo = state.bilder.filter((b) => !b.verbessert);
  let i = 0;
  for (const b of todo) {
    i++;
    busy = `Bild ${i} von ${todo.length} wird verbessert (das kann beim ersten Mal etwas dauern) ...`;
    if (state.schritt === 2) { $('#enhBusy').innerHTML = spinner(busy); renderNav(); }
    try {
      const r = await api('/api/enhance', { body: { id: b.id, blur: state.blur } });
      b.verbessert = r.verbessert;
      b.methode = r.methode;
      b.hinweis = r.hinweis;
    } catch (e) {
      busy = null;
      if (state.schritt === 2) { $('#enhBusy').innerHTML = errBox(e.fehler); renderNav(); }
      return;
    }
    save();
    if (state.schritt === 2) $('#enhCards').innerHTML = state.bilder.map((x, k) => enhCard(x, k)).join('');
  }
  busy = null;
  if (state.schritt === 2) { $('#enhBusy').innerHTML = ''; $('#recalc').disabled = false; renderNav(); toast('Bilder sind fertig.'); }
}

// ===== Schritt 3: Erkennen & Text =====
const CHARS = (t) => `${t.length} / 80`;
function step3(v) {
  v.innerHTML = `
    <h1>Schritt 3: Artikel erkennen & Text</h1>
    <p class="lead">Die KI schaut sich deine Fotos an und schreibt Titel und Beschreibung. Mit ein paar Stichworten wird das Ergebnis genauer.</p>
    <div class="card">
      <label for="kw" style="margin-top:0">Stichworte (optional) ${help('Zum Beispiel: Marke, Modell, Größe, Fehler. Beispiel: "Bremssattel Golf 4 vorne links".')}</label>
      <input type="text" id="kw" data-bind="stichworte" value="${esc(state.stichworte)}" placeholder='z. B. "Bremssattel Golf 4 vorne links"' maxlength="300">
      <label class="check"><input type="checkbox" data-bind="privat" ${state.privat ? 'checked' : ''}><span>Hinweis "Privatverkauf, keine Garantie oder Rücknahme" anhängen ${help('Wird am Ende der Beschreibung automatisch ergänzt. Bei gewerblichen Verkäufen bitte abwählen, dort gelten gesetzliche Rechte.')}</span></label>
      <button class="btn ${state.text ? 'btn-secondary' : 'btn-ok'}" id="analyze" type="button" style="width:100%;margin-top:10px" ${busy ? 'disabled' : ''}>${state.text ? 'Alles neu erkennen' : 'Artikel erkennen und Text erstellen'}</button>
    </div>
    <div id="aiBusy">${busy ? spinner(busy) : ''}</div>
    <div id="aiErr"></div>
    <div id="textForm">${state.text ? textForm() : ''}</div>`;
  $('#analyze').onclick = () => analyze(false);
  if (state.text) bindTextForm();
}

function textForm() {
  const t = state.text;
  const z = status.zustaende || {};
  const s = state.vergleich?.statistik;
  return `
    ${state.warnungen.length ? `<div class="notice warn"><b>Hinweis</b><ul>${state.warnungen.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${t.hinweise?.length ? `<div class="notice info"><b>Bitte prüfen</b><ul>${t.hinweise.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="card">
      <label for="titel" style="margin-top:0">Titel ${help('Maximal 80 Zeichen. Die wichtigsten Suchwörter (Marke, Modell, Artikelart) gehören nach vorne.')}</label>
      <input type="text" id="titel" data-bind="text.titel" value="${esc(t.titel)}" maxlength="120">
      <div class="counter ${t.titel.length > 80 ? 'bad' : ''}" id="titelCount">${CHARS(t.titel)}</div>
      <label for="beschr">Beschreibung</label>
      <textarea id="beschr" data-bind="text.beschreibung" rows="9">${esc(t.beschreibung)}</textarea>
      <div class="row">
        <div><label for="zust">Zustand ${help('Sei ehrlich: Das vermeidet Rückfragen und Ärger.')}</label>
          <select id="zust" data-bind="text.zustand">${Object.entries(z).map(([k, l]) => `<option value="${k}" ${t.zustand === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label for="zb">Zustand kurz beschrieben</label>
          <input type="text" id="zb" data-bind="text.zustandsbeschreibung" value="${esc(t.zustandsbeschreibung)}" maxlength="300"></div>
      </div>
      <div class="row" style="margin-top:8px"><input type="text" id="hint" placeholder='Wunsch für neuen Text, z. B. "kürzer" oder "mehr Details"' maxlength="200" aria-label="Wunsch für neuen Text">
        <button class="btn btn-secondary" id="rewrite" type="button" ${busy ? 'disabled' : ''}>Neu formulieren</button></div>
    </div>
    <div class="card">
      <div class="label" style="margin-top:0">Artikelmerkmale ${help('Angaben wie Marke oder Herstellernummer. Manche Kategorien verlangen bestimmte Merkmale; eBay meldet das beim Einstellen.')}</div>
      <div id="kvList">${t.merkmale.map((m, i) => kvRow(m, i)).join('')}</div>
      <button class="btn btn-secondary btn-small" id="kvAdd" type="button">Merkmal hinzufügen</button>
    </div>
    <div class="card">
      <div class="label" style="margin-top:0">eBay-Kategorie ${help('Die Kategorie bestimmt, wo dein Artikel gefunden wird. Die Vorschläge kommen direkt von eBay. Du kannst auch eine Kategorie-Nummer selbst eintragen.')}</div>
      ${state.kategorien.length ? `<select id="kat" data-bind="kategorieId">${state.kategorien.map((k) => `<option value="${esc(k.id)}" ${state.kategorieId === k.id ? 'selected' : ''}>${esc(k.pfad || k.name)}</option>`).join('')}<option value="" ${state.kategorieId === '' ? 'selected' : ''}>Andere (Nummer unten eintragen)</option></select>` : `<div class="notice warn" style="margin-top:0">Keine Vorschläge verfügbar${status.ebayApp ? '' : ' (eBay-Schlüssel fehlen in den Einstellungen)'}. Bitte trage die Kategorie-Nummer ein.</div>`}
      <label for="katid">Kategorie-Nummer</label>
      <input type="text" id="katid" inputmode="numeric" value="${esc(state.kategorieId)}" placeholder="z. B. 33615" maxlength="12">
    </div>
    <div class="card">
      <div class="label" style="margin-top:0">Preisvorschlag der KI ${help('Basiert auf ähnlichen Angeboten bei eBay.de (sofern verfügbar) und dem Zustand. Du legst den Preis in Schritt 4 selbst fest.')}</div>
      <div class="stats"><div><b>${eur(t.preis_festpreis)}</b><small>Festpreis</small></div><div><b>${eur(t.preis_startpreis)}</b><small>Startpreis Auktion</small></div></div>
      <p class="muted">${esc(t.preis_begruendung)}</p>
      ${s ? `<div class="label">Ähnliche Angebote bei eBay</div><div class="stats"><div><b>${eur(s.min)}</b><small>Min</small></div><div><b>${eur(s.median)}</b><small>Median</small></div><div><b>${eur(s.max)}</b><small>Max</small></div><div><b>${s.anzahl}</b><small>Anzahl</small></div></div>
      <ul class="muted">${(state.vergleich.beispiele || []).slice(0, 4).map((b) => `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.titel)}</a> - ${esc(b.preis)}</li>`).join('')}</ul>` : '<p class="muted">Keine Vergleichsangebote verfügbar.</p>'}
    </div>`;
}
const kvRow = (m, i) => `<div class="kv"><input type="text" placeholder="Name (z. B. Marke)" value="${esc(m.name)}" data-kv="${i}" data-f="name" aria-label="Merkmal-Name"><input type="text" placeholder="Wert" value="${esc(m.wert)}" data-kv="${i}" data-f="wert" aria-label="Merkmal-Wert"><button class="btn btn-danger btn-small" type="button" data-kvdel="${i}" aria-label="Merkmal entfernen">&#10005;</button></div>`;

function bindTextForm() {
  $('#rewrite').onclick = () => analyze(true);
  $('#kvAdd').onclick = () => { state.text.merkmale.push({ name: '', wert: '' }); save(); $('#kvList').innerHTML = state.text.merkmale.map(kvRow).join(''); };
  $('#katid').oninput = (e) => { state.kategorieId = e.target.value.replace(/\D/g, ''); const sel = $('#kat'); if (sel) sel.value = state.kategorien.some((k) => k.id === state.kategorieId) ? state.kategorieId : ''; save(); };
}

async function analyze(rewrite) {
  if (busy) return;
  const hint = $('#hint')?.value || '';
  busy = rewrite ? 'Text wird neu formuliert ...' : 'Die KI schaut sich deine Fotos an und sucht ähnliche Angebote (das dauert bis zu einer Minute) ...';
  $('#aiBusy').innerHTML = spinner(busy);
  $('#aiErr').innerHTML = '';
  $('#analyze').disabled = true;
  renderNav();
  try {
    const body = {
      bilder: state.bilder.map((b) => ({ id: b.id, variante: b.wahl })),
      stichworte: state.stichworte,
    };
    if (rewrite) Object.assign(body, { vorher: toServerResult(state.text), hinweis: hint, vergleich: state.vergleich });
    const r = await api('/api/analyze', { body });
    const e = r.ergebnis;
    const merk = state.text?.merkmale;
    state.text = { ...e, merkmale: rewrite && merk ? merk : e.artikelmerkmale };
    if (rewrite) {
      // Fakten und Preise bleiben, nur Titel/Beschreibung werden ersetzt
      state.text.zustand = e.zustand;
    } else {
      state.vergleich = r.vergleich;
      state.kategorien = r.kategorien || [];
      state.warnungen = r.warnungen || [];
      state.kategorieId = state.kategorien[0]?.id || '';
      const vk = state.verkauf;
      vk.preis = vk.preis || String(e.preis_festpreis || '');
      vk.startpreis = vk.startpreis || String(e.preis_startpreis || '');
      vk.sofortpreis = vk.sofortpreis || String(e.preis_festpreis || '');
      vk.preisvorschlag.annahmeAb = vk.preisvorschlag.annahmeAb || '';
    }
    delete state.text.artikelmerkmale;
    save();
    busy = null;
    step3($('#view'));
    toast(rewrite ? 'Neuer Text ist fertig.' : 'Fertig! Bitte prüfe alles und passe es an.');
  } catch (e) {
    busy = null;
    step3($('#view'));
    $('#aiErr').innerHTML = errBox(e.fehler);
  }
  renderNav();
}
const toServerResult = (t) => ({ ...t, artikelmerkmale: t.merkmale });

// ===== Schritt 4: Verkaufsart =====
const ART = [
  ['festpreis', 'Sofort-Kaufen (Festpreis)', 'Du bestimmst den Preis, der Käufer kauft sofort. Einfach und planbar.'],
  ['auktion', 'Auktion (Bieten)', 'Käufer bieten, das höchste Gebot gewinnt. Gut für gefragte oder seltene Dinge.'],
  ['auktion_sofort', 'Auktion + Sofort-Kaufen', 'Bieten möglich, wer will, kauft vorher sofort zum festen Preis.'],
];
function step4(v) {
  const vk = state.verkauf;
  v.innerHTML = `
    <h1>Schritt 4: Verkaufsart & Versand</h1>
    <p class="lead">Wie möchtest du verkaufen?</p>
    <div class="tiles" role="radiogroup" aria-label="Verkaufsart">${ART.map(([k, t, d]) => `<button type="button" class="tile ${vk.art === k ? 'sel' : ''}" role="radio" aria-checked="${vk.art === k}" data-art="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
    <div class="card" id="preise">${preiseForm()}</div>
    <div class="card" id="kontoCard">${kontoForm()}</div>`;
  if (!konto && !kontoFehler && !busy) loadKonto();
}
function preiseForm() {
  const vk = state.verkauf;
  const t = state.text || {};
  const fest = vk.art === 'festpreis';
  const days = [1, 3, 5, 7, 10];
  return `
    ${fest ? `<label for="p1" style="margin-top:0">Festpreis in Euro ${help('Der Preis, zu dem Käufer sofort kaufen können.')}</label>
      <input type="text" id="p1" inputmode="decimal" data-bind="verkauf.preis" value="${esc(vk.preis)}" placeholder="z. B. 24,90"><p class="muted">KI-Vorschlag: ${eur(t.preis_festpreis)}</p>` : `
      <label for="p2" style="margin-top:0">Startpreis in Euro ${help('Mit diesem Preis beginnt die Auktion. Ein niedriger Startpreis lockt mehr Bieter an.')}</label>
      <input type="text" id="p2" inputmode="decimal" data-bind="verkauf.startpreis" value="${esc(vk.startpreis)}" placeholder="z. B. 1,00"><p class="muted">KI-Vorschlag: ${eur(t.preis_startpreis)}</p>
      ${vk.art === 'auktion_sofort' ? `<label for="p3">Sofort-Kaufen-Preis in Euro</label><input type="text" id="p3" inputmode="decimal" data-bind="verkauf.sofortpreis" value="${esc(vk.sofortpreis)}">` : ''}
      <label for="p4">Mindestpreis (optional) ${help('Wird dieser Preis nicht erreicht, musst du nicht verkaufen. Bei eBay kostet diese Option eine Gebühr und mindert das Interesse der Bieter. Meist besser leer lassen.')}</label>
      <input type="text" id="p4" inputmode="decimal" data-bind="verkauf.reservePreis" value="${esc(vk.reservePreis)}" placeholder="leer lassen = kein Mindestpreis">
      <label for="dauer">Dauer der Auktion</label>
      <select id="dauer" data-bind="verkauf.dauerTage" data-num="1">${days.map((d) => `<option value="${d}" ${Number(vk.dauerTage) === d ? 'selected' : ''}>${d} ${d === 1 ? 'Tag' : 'Tage'}</option>`).join('')}</select>`}
    ${fest ? `<label class="check" style="margin-top:16px"><input type="checkbox" data-bind="verkauf.preisvorschlag.aktiv" data-rerender="preise" ${vk.preisvorschlag.aktiv ? 'checked' : ''}><span>Preisvorschlag erlauben ${help('Käufer können dir einen niedrigeren Preis anbieten. Du kannst annehmen, ablehnen oder gegenbieten. Optional entscheidet eBay automatisch anhand deiner Grenzen.')}</span></label>
      ${vk.preisvorschlag.aktiv ? `<div class="row"><div><label for="ba">Automatisch annehmen ab (optional)</label><input type="text" id="ba" inputmode="decimal" data-bind="verkauf.preisvorschlag.annahmeAb" value="${esc(vk.preisvorschlag.annahmeAb)}" placeholder="z. B. 22,00"></div>
      <div><label for="bd">Automatisch ablehnen unter (optional)</label><input type="text" id="bd" inputmode="decimal" data-bind="verkauf.preisvorschlag.ablehnenUnter" value="${esc(vk.preisvorschlag.ablehnenUnter)}" placeholder="z. B. 15,00"></div></div>` : ''}
      <label for="menge">Menge ${help('Wie viele Stück du verkaufst. Bei Auktionen ist es immer 1.')}</label>
      <input type="number" id="menge" min="1" max="999" data-bind="verkauf.menge" data-num="1" value="${esc(vk.menge)}">` : '<p class="muted">Bei Auktionen wird immer 1 Stück angeboten.</p>'}`;
}
function kontoForm() {
  const vk = state.verkauf;
  if (kontoFehler) return `<div class="label" style="margin-top:0">Versand & Zahlung</div>${errBox(kontoFehler)}<button class="btn btn-secondary btn-small" id="kontoRetry" type="button">Erneut laden</button>`;
  if (!konto) return `<div class="label" style="margin-top:0">Versand & Zahlung</div>${spinner('Richtlinien aus deinem eBay-Konto werden geladen ...')}`;
  if (konto.optInNoetig) return `<div class="label" style="margin-top:0">Geschäftsrichtlinien</div><div class="notice warn">Für Versand-, Zahlungs- und Rückgaberichtlinien muss dein eBay-Konto die "Geschäftsrichtlinien" aktivieren (kostenlos).</div><button class="btn btn-primary" id="optin" type="button">Jetzt aktivieren</button>`;
  const sel = (id, key, items, label, helpTxt, extra = '') => `<label for="${id}">${label} ${help(helpTxt)}</label>
    ${items.length ? `<select id="${id}" data-bind="verkauf.${key}"><option value="">Bitte wählen ...</option>${items.map((x) => `<option value="${esc(x.id)}" ${vk[key] === x.id ? 'selected' : ''}>${esc(x.name)}${extra && x.abholung ? ' (Abholung)' : ''}</option>`).join('')}</select>`
      : `<div class="notice warn" style="margin-top:0">Keine Richtlinie gefunden. Lege sie in deinem eBay-Konto an: Verkäufer-Center, Konto, Geschäftsrichtlinien. Danach hier "Neu laden".</div>`}`;
  return `
    ${konto.demo ? '<div class="notice demo">Demo: Diese Richtlinien sind Beispiele.</div>' : ''}
    <div class="label" style="margin-top:0">Versand & Zahlung</div>
    ${sel('vs', 'versandId', konto.versand, 'Versand / Abholung', 'Die Versandrichtlinie legt fest, wie und zu welchem Preis du verschickst. Richtlinien mit "(Abholung)" erlauben Selbstabholung.', 1)}
    ${sel('zl', 'zahlungId', konto.zahlung, 'Zahlung', 'Zahlungsrichtlinie aus deinem eBay-Konto.')}
    ${sel('rg', 'rueckgabeId', konto.rueckgabe, 'Rückgabe', 'Rückgaberichtlinie aus deinem eBay-Konto. Auch Privatverkäufer wählen hier eine aus (z. B. "Keine Rücknahme").')}
    <label for="so">Standort (wo der Artikel liegt) ${help('eBay braucht einen Artikelstandort. Es reicht Postleitzahl und Ort; die genaue Adresse wird nicht angezeigt.')}</label>
    ${konto.standorte.length ? `<select id="so" data-bind="verkauf.standort"><option value="">Bitte wählen ...</option>${konto.standorte.map((x) => `<option value="${esc(x.key)}" ${vk.standort === x.key ? 'selected' : ''}>${esc(x.name)}${x.ort ? ' - ' + esc(x.ort) : ''}</option>`).join('')}</select>` : `
      <div class="notice info" style="margin-top:0">Es ist noch kein Standort angelegt. Das holen wir jetzt nach:</div>
      <div class="row"><input type="text" id="plz" placeholder="PLZ" inputmode="numeric" maxlength="5" aria-label="Postleitzahl"><input type="text" id="ort" placeholder="Ort" aria-label="Ort"><select id="land" aria-label="Land"><option value="DE">Deutschland</option><option value="AT">Österreich</option><option value="CH">Schweiz</option></select></div>
      <button class="btn btn-primary" id="mkLoc" type="button" style="margin-top:10px">Standort anlegen</button>`}
    <p style="margin-top:14px"><button class="btn btn-secondary btn-small" id="kontoRetry" type="button">Richtlinien neu laden</button></p>`;
}
async function loadKonto() {
  kontoFehler = null;
  try {
    konto = await api('/api/konto');
    const vk = state.verkauf;
    const one = (list, key, idk = 'id') => { if (list?.length === 1 && !list.some((x) => x[idk] === vk[key])) vk[key] = list[0][idk]; else if (vk[key] && !list?.some((x) => x[idk] === vk[key])) vk[key] = ''; };
    one(konto.versand, 'versandId'); one(konto.zahlung, 'zahlungId'); one(konto.rueckgabe, 'rueckgabeId'); one(konto.standorte, 'standort', 'key');
    save();
  } catch (e) {
    kontoFehler = e.fehler;
  }
  if (state.schritt === 4) { const c = $('#kontoCard'); if (c) c.innerHTML = kontoForm(); }
}

// ===== Schritt 5: Vorschau & Einstellen =====
function step5(v) {
  const t = state.text;
  const vk = state.verkauf;
  const imgs = state.bilder.map((b) => (b.wahl === 'verbessert' && b.verbessert ? b.verbessert : b.url));
  const priceLine = vk.art === 'festpreis' ? `${eur(vk.preis)} <span class="tag">Sofort-Kaufen</span>${vk.preisvorschlag.aktiv ? '<span class="tag">Preisvorschlag möglich</span>' : ''}`
    : vk.art === 'auktion' ? `${eur(vk.startpreis)} <span class="tag">Auktion, ${vk.dauerTage} Tage</span>`
      : `${eur(vk.startpreis)} <span class="tag">Auktion, ${vk.dauerTage} Tage</span><div class="muted">oder Sofort-Kaufen für ${eur(vk.sofortpreis)}</div>`;
  const polName = (list, id, k = 'id') => konto?.[list]?.find((x) => x[k] === id)?.name || '-';
  if (ergebnis?.url) {
    v.innerHTML = `<div class="card success"><div class="big" aria-hidden="true">&#10003;</div>
      <h1>${ergebnis.demo ? 'Demo: So wäre es gelaufen' : 'Dein Artikel ist online!'}</h1>
      ${ergebnis.demo ? '<div class="notice demo">Das war eine Simulation. Es wurde nichts bei eBay veröffentlicht. Verbinde dein eBay-Konto in den Einstellungen, um wirklich einzustellen.</div>' : ''}
      <p>Angebotsnummer: <b>${esc(ergebnis.listingId)}</b></p>
      <div class="btn-row"><a class="btn btn-primary" href="${esc(ergebnis.url)}" target="_blank" rel="noopener">${ergebnis.demo ? 'Beispiel-Link (existiert nicht)' : 'Angebot bei eBay ansehen'}</a>
      <button class="btn btn-secondary" id="again" type="button">Nächsten Artikel einstellen</button></div></div>`;
    $('#again').onclick = () => { state = freshState(); ergebnis = null; konto = konto && { ...konto }; save(); render(); window.scrollTo(0, 0); };
    return;
  }
  v.innerHTML = `
    <h1>Schritt 5: Vorschau & Einstellen</h1>
    <p class="lead">So ungefähr sieht dein Angebot aus. Prüfe alles in Ruhe.</p>
    <div class="card preview">
      <div class="gallery">${imgs.map((s, i) => `<img src="${esc(s)}" alt="Foto ${i + 1}">`).join('')}</div>
      <div class="pbody">
        <p class="ptitle">${esc(t.titel)}</p>
        <div class="price">${priceLine}</div>
        <p class="muted">Zustand: ${esc(status.zustaende?.[t.zustand] || t.zustand)} | Menge: ${vk.art === 'festpreis' ? esc(vk.menge) : 1} | Versand: ${esc(polName('versand', vk.versandId))}</p>
        ${t.merkmale.filter((m) => m.name && m.wert).length ? `<table>${t.merkmale.filter((m) => m.name && m.wert).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.wert)}</td></tr>`).join('')}</table>` : ''}
        <h3>Beschreibung</h3>
        <div class="desc">${esc(t.beschreibung)}${state.privat ? `\n\nPrivatverkauf, keine Garantie oder Rücknahme.` : ''}</div>
      </div>
    </div>
    <div id="pubArea">${busy ? spinner(busy) : ''}</div>
    <div id="pubErr">${ergebnis?.fehler ? errBox(ergebnis.fehler) : ''}</div>
    <button class="btn btn-ok" id="publish" type="button" style="width:100%" ${busy ? 'disabled' : ''}>${status.demoEbay ? 'Einstellen simulieren (Demo)' : 'Jetzt bei eBay einstellen'}</button>
    <p class="muted" style="text-align:center">${status.demoEbay ? 'Demo-Modus: Es wird nichts veröffentlicht.' : 'Das Angebot wird sofort veröffentlicht. Es können eBay-Gebühren anfallen.'}</p>`;
  $('#publish').onclick = publish;
}
async function publish() {
  if (busy) return;
  const t = state.text;
  const vk = state.verkauf;
  busy = status.demoEbay ? 'Simulation läuft ...' : 'Bilder werden zu eBay hochgeladen und das Angebot wird erstellt (das dauert bis zu einer Minute) ...';
  $('#pubArea').innerHTML = spinner(busy);
  $('#pubErr').innerHTML = '';
  $('#publish').disabled = true;
  renderNav();
  const draft = {
    titel: t.titel, beschreibung: t.beschreibung, zustand: t.zustand, zustandsbeschreibung: t.zustandsbeschreibung,
    merkmale: t.merkmale, privat: state.privat, kategorieId: state.kategorieId,
    bilder: state.bilder.map((b) => ({ id: b.id, variante: b.wahl })),
    verkauf: { ...vk, menge: Number(vk.menge) || 1, dauerTage: Number(vk.dauerTage) || 7 },
  };
  try {
    ergebnis = await api('/api/einstellen', { body: draft });
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignorieren */ }
  } catch (e) {
    ergebnis = { fehler: e.fehler };
  }
  busy = null;
  render();
}

// ===== Einstellungen =====
async function renderSettings() {
  renderBanner();
  $('#progress').classList.add('hide');
  $('#navbar').classList.add('hidden');
  const hash = new URLSearchParams(location.hash.split('?')[1] || '');
  const v = $('#view');
  v.innerHTML = spinner('Lade Einstellungen ...');
  let c;
  try { c = await api('/api/config'); } catch (e) { v.innerHTML = errBox(e.fehler); return; }
  status = { ...status, ...(await api('/api/status').catch(() => ({}))) };
  renderBanner();
  const set = (k) => (c.secrets[k] ? 'gesetzt &#10003;' : 'nicht gesetzt');
  const env = (k) => (c.fromEnv[k] ? ' <span class="tag">aus .env</span>' : '');
  v.innerHTML = `
    <h1>Einstellungen</h1>
    <p class="lead">Das musst du nur einmal machen. Ohne Schlüssel läuft die App im Demo-Modus, dann kannst du alles ausprobieren.</p>
    ${hash.get('ebay') === 'ok' ? '<div class="notice ok" role="status"><b>Verbunden!</b>Dein eBay-Konto ist jetzt verbunden.</div>' : ''}
    ${hash.get('fehler') ? `<div class="notice err" role="alert"><b>Das hat nicht geklappt</b>${esc(hash.get('fehler'))}</div>` : ''}
    <div id="setMsg"></div>
    <div class="card">
      <h2 style="margin-top:0">1. Zugangsdaten</h2>
      <p class="muted">Schlüssel werden nur auf deinem Rechner gespeichert (Datei <code>data/config.json</code>) und nie wieder angezeigt. Leer lassen = unverändert.</p>
      <label for="cid">eBay App ID (Client ID): ${set('ebayClientId')}${env('ebayClientId')}</label>
      <input type="password" id="cid" autocomplete="off" placeholder="${c.secrets.ebayClientId ? 'gesetzt - zum Ändern neu eingeben' : 'z. B. MaxMuste-Verkauf-SBX-...'}">
      <label for="cert">eBay Cert ID (Client Secret): ${set('ebayCertId')}${env('ebayCertId')}</label>
      <input type="password" id="cert" autocomplete="off" placeholder="${c.secrets.ebayCertId ? 'gesetzt - zum Ändern neu eingeben' : ''}">
      <label for="ru">RuName (Redirect-URL-Name)${env('ebayRuName')} ${help('Das ist ein von eBay erzeugter Name (kein normaler Link), der auf die Rückkehr-Adresse dieser App zeigt. Siehe Anleitung unten.')}</label>
      <input type="text" id="ru" autocomplete="off" value="${esc(c.ebayRuName)}" placeholder="z. B. Max_Muster-MaxMuste-Verkau-abcdef">
      <div class="label">Umgebung${env('ebayEnv')} ${help('Sandbox ist ein Testgelände von eBay ohne echte Angebote. Wähle "Produktion" erst, wenn alles klappt.')}</div>
      <div class="seg"><label><input type="radio" name="env" value="sandbox" ${c.ebayEnv === 'sandbox' ? 'checked' : ''}><span>Sandbox (Test)</span></label><label><input type="radio" name="env" value="production" ${c.ebayEnv === 'production' ? 'checked' : ''}><span>Produktion (echt)</span></label></div>
      <label for="ak">Anthropic API Key (Claude): ${set('anthropicKey')}${env('anthropicKey')}</label>
      <input type="password" id="ak" autocomplete="off" placeholder="${c.secrets.anthropicKey ? 'gesetzt - zum Ändern neu eingeben' : 'sk-ant-...'}">
      <p class="muted">KI-Modell: <code>${esc(c.claudeModel)}</code> (änderbar mit <code>CLAUDE_MODEL</code> in der .env)</p>
      <div class="btn-row"><button class="btn btn-primary" id="saveCfg" type="button">Speichern</button></div>
      ${Object.values(c.secrets).some(Boolean) ? `<p><button class="linkbtn" id="clearKeys" type="button">Gespeicherte Schlüssel löschen</button></p>` : ''}
    </div>
    <div class="card">
      <h2 style="margin-top:0">2. Mit eBay verbinden</h2>
      <p>Status: <b>${c.ebayConnected ? 'verbunden &#10003;' : 'nicht verbunden'}</b> (${c.ebayEnv === 'production' ? 'Produktion' : 'Sandbox'})</p>
      <div class="btn-row"><a class="btn btn-primary" href="/auth/ebay/start">Mit eBay verbinden</a>${c.ebayConnected ? '<button class="btn btn-danger" id="disc" type="button">Verbindung trennen</button>' : ''}</div>
      <details style="margin-top:14px"><summary>Rückkehr klappt nicht? Code von Hand einfügen</summary>
        <p class="muted">Wenn nach dem eBay-Login eine Fehlerseite erscheint (z. B. weil eBay eine https-Adresse verlangt), kopiere die komplette Adresse aus der Adresszeile des Browsers hierher. Sie enthält <code>code=...</code>.</p>
        <textarea id="codeIn" rows="3" style="min-height:90px" placeholder="https://...?code=v^1.1#i^1...&expires_in=299"></textarea>
        <button class="btn btn-secondary btn-small" id="codeBtn" type="button" style="margin-top:8px">Code verwenden</button></details>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Anleitung: Schritt für Schritt</h2>
      <ol class="steps">
        <li>Konto beim <a href="https://developer.ebay.com/" target="_blank" rel="noopener">eBay Developer Portal</a> anlegen (kostenlos) und anmelden.</li>
        <li>Unter <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener">Application Keys</a> ein Schlüsselpaar für <b>Sandbox</b> (zum Testen) oder <b>Production</b> erzeugen. Du bekommst <b>App ID (Client ID)</b> und <b>Cert ID (Client Secret)</b>. Für Production verlangt eBay evtl. eine Bestätigung (Marketplace Account Deletion Endpoint oder Befreiung).</li>
        <li>In der Zeile "User Tokens" auf <b>"Get a Token from eBay via Your Application"</b> klicken und eine Redirect-URL anlegen: Als "Auth Accepted URL" trägst du <code>${esc(status.callbackHinweis || 'http://localhost:3000/auth/ebay/callback')}</code> ein (eBay verlangt dafür häufig https, z. B. über einen Tunnel wie ngrok; sonst nutze die Code-Eingabe oben). Den erzeugten <b>RuName</b> hier eintragen.</li>
        <li>Anthropic API Key unter <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> erstellen und oben eintragen.</li>
        <li>Oben auf <b>Speichern</b>, dann auf <b>Mit eBay verbinden</b> klicken und bei eBay erlauben.</li>
        <li><b>Geschäftsrichtlinien aktivieren:</b> Bei eBay im Verkäufer-Center unter <i>Konto &gt; Geschäftsrichtlinien</i> (Business Policies) aktivieren und mindestens je eine Versand-, Zahlungs- und Rückgaberichtlinie anlegen. In Schritt 4 der App kannst du die Aktivierung auch per Knopfdruck auslösen.</li>
      </ol>
    </div>`;
  $('#saveCfg').onclick = async () => {
    const body = { ebayClientId: $('#cid').value, ebayCertId: $('#cert').value, ebayRuName: $('#ru').value, ebayEnv: document.querySelector('input[name=env]:checked').value, anthropicKey: $('#ak').value };
    try { await api('/api/config', { body }); toast('Gespeichert.'); renderSettings(); } catch (e) { $('#setMsg').innerHTML = errBox(e.fehler); }
  };
  const ck = $('#clearKeys');
  if (ck) ck.onclick = async () => { if (confirm('Alle gespeicherten Schlüssel löschen?')) { await api('/api/config', { body: { loeschen: ['ebayClientId', 'ebayCertId', 'anthropicKey'] } }); renderSettings(); } };
  const d = $('#disc');
  if (d) d.onclick = async () => { await api('/api/ebay/trennen', { body: {} }); toast('Verbindung getrennt.'); renderSettings(); };
  $('#codeBtn').onclick = async () => {
    try { await api('/api/ebay/code', { body: { code: $('#codeIn').value } }); toast('Verbunden.'); renderSettings(); } catch (e) { $('#setMsg').innerHTML = errBox(e.fehler); }
  };
}

// ---------- Globale Ereignisse ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, figure');
  if (!t) return;
  if (t.matches('.help')) {
    const open = t.getAttribute('aria-expanded') === 'true';
    t.setAttribute('aria-expanded', String(!open));
    const host = t.closest('label, .label, div') || t.parentElement;
    const nxt = host.nextElementSibling;
    if (open && nxt?.classList.contains('helptext')) nxt.remove();
    else if (!open) host.insertAdjacentHTML('afterend', `<div class="helptext" role="note">${esc(t.dataset.help)}</div>`);
    return;
  }
  if (t.dataset.go) return go(Number(t.dataset.go));
  if (t.dataset.del) return removeImage(t.dataset.del);
  if (t.dataset.move !== undefined) {
    const i = Number(t.dataset.move);
    const j = i + Number(t.dataset.dir);
    if (state.bilder[j]) { [state.bilder[i], state.bilder[j]] = [state.bilder[j], state.bilder[i]]; save(); step1($('#view')); }
    return;
  }
  if (t.dataset.pick) {
    const b = state.bilder.find((x) => x.id === t.dataset.pick);
    if (b) { b.wahl = t.dataset.w; save(); $('#enhCards').innerHTML = state.bilder.map(enhCard).join(''); }
    return;
  }
  if (t.dataset.art) { state.verkauf.art = t.dataset.art; save(); step4($('#view')); return; }
  if (t.id === 'kontoRetry') { konto = null; kontoFehler = null; step4($('#view')); return; }
  if (t.dataset.kvdel !== undefined) { state.text.merkmale.splice(Number(t.dataset.kvdel), 1); save(); $('#kvList').innerHTML = state.text.merkmale.map(kvRow).join(''); return; }
  if (t.id === 'optin') {
    t.disabled = true;
    api('/api/konto/optin', { body: {} }).then(() => { konto = null; step4($('#view')); }).catch((er) => { $('#kontoCard').insertAdjacentHTML('afterbegin', errBox(er.fehler)); t.disabled = false; });
    return;
  }
  if (t.id === 'mkLoc') {
    t.disabled = true;
    api('/api/standort', { body: { plz: $('#plz').value.trim(), ort: $('#ort').value.trim(), land: $('#land').value } })
      .then((r) => { state.verkauf.standort = r.key; save(); konto = null; step4($('#view')); })
      .catch((er) => { toast(er.fehler.text); t.disabled = false; });
  }
});
document.addEventListener('input', (e) => onChange(e));
document.addEventListener('change', (e) => onChange(e, true));
function onChange(e, isChange = false) {
  const el = e.target;
  if (el.dataset.kv !== undefined) { state.text.merkmale[Number(el.dataset.kv)][el.dataset.f] = el.value; save(); return; }
  if (el.dataset.wahl && isChange) {
    const b = state.bilder.find((x) => x.id === el.dataset.wahl);
    if (b) { b.wahl = el.value; save(); $('#enhCards').innerHTML = state.bilder.map(enhCard).join(''); }
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  if (el.type === 'checkbox') {
    setPath(state, path, el.checked);
    if (isChange && el.dataset.rerender === 'preise') $('#preise').innerHTML = preiseForm();
  } else {
    let val = el.value;
    if (el.dataset.num) val = Number(val);
    setPath(state, path, val);
    if (path === 'text.titel') { const c = $('#titelCount'); c.textContent = CHARS(val); c.classList.toggle('bad', val.length > 80); }
    if (path === 'kategorieId') { const k = $('#katid'); if (k) k.value = val; }
  }
  save();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
$('#brand').addEventListener('click', () => { if (location.hash) { history.replaceState(null, '', location.pathname); render(); } });

// ---------- Start ----------
(async function init() {
  themeInit();
  const restored = load();
  try { status = { ...status, ...(await api('/api/status')) }; } catch (e) { $('#view').innerHTML = errBox(e.fehler); return; }
  if (restored && !location.hash) setTimeout(() => toast('Dein letzter Entwurf wurde wiederhergestellt.'), 400);
  if (state.bilder.some((b) => !b.verbessert) && state.schritt > 2) state.bilder.forEach((b) => { if (!b.verbessert) b.verbessert = null; });
  render();
})();
