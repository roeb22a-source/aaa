// KI-Anbindung: Claude (Vision) erzeugt Titel, Beschreibung, Zustand, Merkmale und Preisvorschlag.
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config.js';
import { AppError, round2, truncateTitle } from './util.js';
import { CONDITIONS } from './ebay/inventory.js';

const CONDITION_KEYS = Object.keys(CONDITIONS);

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['artikel', 'suchbegriff', 'titel', 'beschreibung', 'zustand', 'zustandsbeschreibung', 'artikelmerkmale', 'preis_festpreis', 'preis_startpreis', 'preis_begruendung', 'hinweise'],
  properties: {
    artikel: { type: 'string', description: 'Kurze Bezeichnung des Artikels' },
    suchbegriff: { type: 'string', description: 'Suchbegriff für Vergleichsangebote bei eBay' },
    titel: { type: 'string', description: 'eBay-Titel, höchstens 80 Zeichen' },
    beschreibung: { type: 'string', description: 'Verkaufstext auf Deutsch, Absätze durch Leerzeilen getrennt' },
    zustand: { type: 'string', enum: CONDITION_KEYS },
    zustandsbeschreibung: { type: 'string', description: 'Ein bis zwei Sätze zum Zustand, z. B. Gebrauchsspuren' },
    artikelmerkmale: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'wert'],
        properties: { name: { type: 'string' }, wert: { type: 'string' } },
      },
    },
    preis_festpreis: { type: 'number', description: 'Vorschlag Festpreis in Euro' },
    preis_startpreis: { type: 'number', description: 'Vorschlag Startpreis Auktion in Euro' },
    preis_begruendung: { type: 'string' },
    hinweise: { type: 'array', items: { type: 'string' }, description: 'Dinge, die der Verkäufer prüfen oder ergänzen sollte' },
  },
};

const IDENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suchbegriff'],
  properties: { suchbegriff: { type: 'string' } },
};

const SYSTEM = `Du bist ein erfahrener eBay-Verkaufsberater für Privatpersonen in Deutschland (Marktplatz eBay.de).
Du bekommst Fotos eines Artikels, optional Stichworte des Verkäufers und optional Vergleichsangebote.
Regeln:
- Alle Texte auf Deutsch, freundlich, klar und ehrlich. Erfinde keine Eigenschaften, die auf den Fotos oder in den Stichworten nicht erkennbar sind; Unsicheres gehört in "hinweise" (z. B. "Herstellernummer prüfen").
- Titel: höchstens 80 Zeichen, die wichtigsten Suchbegriffe zuerst (Marke, Modell, Artikelart, Kompatibilität/Größe), keine Werbefloskeln, keine Großschreibung ganzer Wörter.
- Beschreibung: kurze Absätze, Leerzeile dazwischen, kein HTML, keine Emojis. Enthält: was es ist, Zustand ehrlich benannt, Lieferumfang, Maße/Kompatibilität soweit bekannt. Kein Hinweis auf Privatverkauf (wird separat ergänzt).
- Zustand: wähle genau einen Wert der Liste (NEW, LIKE_NEW, NEW_OTHER, NEW_WITH_DEFECTS, USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE, FOR_PARTS_OR_NOT_WORKING).
- Artikelmerkmale: eBay-übliche Namen auf Deutsch (Marke, Modell, Herstellernummer, Farbe, Material, Kompatibel mit ...). Nur Werte, die sicher oder sehr wahrscheinlich sind.
- Preise in Euro, realistisch für den Gebrauchtmarkt. Orientiere dich an den Vergleichsangeboten (Median), wenn vorhanden, und berücksichtige den Zustand. Der Startpreis für Auktionen liegt deutlich niedriger (typisch 30-60 % des Festpreises, oft 0,99 oder 1 Euro für Lockangebote). Begründe kurz in einem Satz.`;

function client() {
  const { anthropicKey } = getConfig();
  if (!anthropicKey) throw new AppError(400, 'Anthropic-Schlüssel fehlt', 'Bitte trage in den Einstellungen deinen Anthropic API Key ein.', { einstellungen: true });
  return new Anthropic({ apiKey: anthropicKey, maxRetries: 2, timeout: 120_000 });
}

function imageBlocks(buffers) {
  return buffers.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }));
}

async function callClaude({ content, schema, maxTokens = 4000 }) {
  const c = client();
  const cfg = getConfig();
  const params = {
    model: cfg.claudeModel,
    max_tokens: maxTokens,
    system: SYSTEM,
    output_config: { effort: process.env.CLAUDE_EFFORT || 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  };
  const useFallback = String(process.env.CLAUDE_FALLBACK || 'on').toLowerCase() !== 'off';
  const send = (withFallback) =>
    withFallback
      ? c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : c.messages.create(params);
  let res;
  try {
    try {
      res = await send(useFallback);
    } catch (e) {
      // Falls die Fallback-Option nicht akzeptiert wird (z. B. anderes Modell), ohne sie erneut versuchen.
      if (useFallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message))) res = await send(false);
      else throw e;
    }
  } catch (e) {
    throw translateAnthropicError(e);
  }
  if (res.stop_reason === 'refusal') {
    throw new AppError(422, 'KI hat abgelehnt', 'Die KI konnte zu diesem Artikel keinen Text erstellen. Bitte versuche es mit anderen Fotos oder Stichworten.');
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(502, 'Unerwartete KI-Antwort', 'Die KI-Antwort war nicht lesbar. Bitte klicke noch einmal auf "Neu formulieren".');
  }
}

function translateAnthropicError(e) {
  if (e instanceof AppError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AppError(401, 'Anthropic-Schlüssel ungültig', 'Der Anthropic API Key wurde abgelehnt. Bitte prüfe ihn in den Einstellungen.', { einstellungen: true });
  if (e instanceof Anthropic.PermissionDeniedError) return new AppError(403, 'Kein Zugriff', 'Dein Anthropic-Konto darf dieses Modell nicht nutzen. Du kannst in der .env mit CLAUDE_MODEL ein anderes eintragen.');
  if (e instanceof Anthropic.NotFoundError) return new AppError(404, 'Modell nicht gefunden', `Das Modell "${getConfig().claudeModel}" existiert nicht. Prüfe CLAUDE_MODEL in der .env.`);
  if (e instanceof Anthropic.RateLimitError) return new AppError(429, 'Zu viele Anfragen', 'Die KI ist gerade ausgelastet. Bitte warte kurz und versuche es erneut.');
  if (e instanceof Anthropic.BadRequestError) {
    const m = String(e.message || '');
    if (/credit|balance/i.test(m)) return new AppError(402, 'Guthaben aufgebraucht', 'Bei Anthropic ist kein Guthaben mehr vorhanden. Bitte lade es in der Anthropic Console auf.');
    return new AppError(400, 'KI-Anfrage abgelehnt', `Die KI hat die Anfrage abgelehnt: ${m.slice(0, 200)}`);
  }
  if (e instanceof Anthropic.APIConnectionError) return new AppError(502, 'Keine Verbindung zur KI', 'Die Verbindung zu Anthropic ist fehlgeschlagen. Prüfe deine Internetverbindung.');
  if (e instanceof Anthropic.APIError) return new AppError(502, 'KI-Fehler', `Anthropic meldet einen Fehler (${e.status}). Bitte versuche es später erneut.`);
  return new AppError(500, 'KI-Fehler', String(e.message || e));
}

function comparablesText(comp) {
  if (!comp?.statistik) return 'Keine Vergleichsangebote verfügbar.';
  const s = comp.statistik;
  const lines = [`Vergleichsangebote bei eBay.de (${s.anzahl} Treffer): min ${s.min} EUR, Median ${s.median} EUR, max ${s.max} EUR.`];
  for (const b of comp.beispiele || []) lines.push(`- ${b.titel} | ${b.preis} | ${b.zustand}`);
  return lines.join('\n');
}

/** Stufe 1 (nur ohne Stichworte): Artikel grob erkennen, um Vergleichsangebote suchen zu können. */
export async function identify(imageBuffers) {
  const r = await callClaude({
    schema: IDENT_SCHEMA,
    maxTokens: 500,
    content: [...imageBlocks(imageBuffers), { type: 'text', text: 'Welcher Artikel ist das? Gib einen kurzen deutschen eBay-Suchbegriff (Marke, Modell, Artikelart) zurück.' }],
  });
  return String(r.suchbegriff || '').trim();
}

export async function generateListing({ imageBuffers, keywords, comparables, previous, hint }) {
  const parts = [...imageBlocks(imageBuffers)];
  let text = `Erstelle den eBay-Entwurf für diesen Artikel.\nStichworte des Verkäufers: ${keywords?.trim() || '(keine)'}\n\n${comparablesText(comparables)}`;
  if (previous) {
    text += `\n\nDas ist der bisherige Entwurf:\n${JSON.stringify(previous)}\nFormuliere Titel und Beschreibung neu und anders, behalte die Fakten bei.`;
    if (hint?.trim()) text += `\nWunsch des Verkäufers: ${hint.trim()}`;
  }
  parts.push({ type: 'text', text });
  const r = await callClaude({ content: parts, schema: RESULT_SCHEMA });
  return normalizeResult(r);
}

export function normalizeResult(r = {}) {
  return {
    artikel: String(r.artikel || ''),
    suchbegriff: String(r.suchbegriff || ''),
    titel: truncateTitle(r.titel, 80),
    beschreibung: String(r.beschreibung || '').trim(),
    zustand: CONDITION_KEYS.includes(r.zustand) ? r.zustand : 'USED_GOOD',
    zustandsbeschreibung: String(r.zustandsbeschreibung || ''),
    artikelmerkmale: (Array.isArray(r.artikelmerkmale) ? r.artikelmerkmale : []).map((m) => ({ name: String(m.name || ''), wert: String(m.wert || '') })),
    preis_festpreis: round2(r.preis_festpreis) || 0,
    preis_startpreis: round2(r.preis_startpreis) || 0,
    preis_begruendung: String(r.preis_begruendung || ''),
    hinweise: (Array.isArray(r.hinweise) ? r.hinweise : []).map(String),
  };
}

/** Beispieltext für den Demo-Modus (keine KI nötig). */
export function demoListing(keywords = '', comparables = null, variant = 0) {
  const k = keywords.trim() || 'Beispielartikel';
  const median = comparables?.statistik?.median;
  const fest = median || 24.9;
  const intro = ['Zum Verkauf steht', 'Hier biete ich an', 'Ich verkaufe'][variant % 3];
  return normalizeResult({
    artikel: k,
    suchbegriff: k,
    titel: `${k} - gepflegter Zustand - Beispieltitel (Demo)`,
    beschreibung: `${intro} ${k} in gepflegtem, gebrauchtem Zustand.\n\nDas ist ein Beispieltext aus dem Demo-Modus. Mit eingetragenem Anthropic-Schlüssel schaut sich die KI deine Fotos an und schreibt hier einen passenden, ehrlichen Verkaufstext.\n\nBitte schau dir die Fotos genau an, sie gehören zur Beschreibung. Bei Fragen melde dich gern.`,
    zustand: 'USED_VERY_GOOD',
    zustandsbeschreibung: 'Leichte Gebrauchsspuren, voll funktionsfähig (Beispielangabe).',
    artikelmerkmale: [
      { name: 'Marke', wert: 'Beispielmarke' },
      { name: 'Herstellernummer', wert: '12345' },
      { name: 'Farbe', wert: 'Schwarz' },
    ],
    preis_festpreis: fest,
    preis_startpreis: Math.max(1, Math.round(fest * 0.4)),
    preis_begruendung: median ? `Demo: Der Median ähnlicher Angebote liegt bei ${median} EUR.` : 'Demo: Beispielpreis, keine echte Marktanalyse.',
    hinweise: ['Dies ist ein Demo-Entwurf. Bitte alle Angaben prüfen.'],
  });
}
