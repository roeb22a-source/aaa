// Inventory API: Artikel, Angebot, Veröffentlichen, Standorte + reine Mapping-Funktionen.
import { ebayFetch, hosts } from './http.js';
import { getUserToken } from './auth.js';
import { AppError, escapeHtml, formatMoney, truncateTitle } from '../util.js';

export const CONDITIONS = {
  NEW: 'Neu',
  LIKE_NEW: 'Neuwertig',
  NEW_OTHER: 'Neu (ohne Originalverpackung)',
  NEW_WITH_DEFECTS: 'Neu mit Fehlern',
  USED_EXCELLENT: 'Gebraucht - Sehr gut',
  USED_VERY_GOOD: 'Gebraucht - Gut',
  USED_GOOD: 'Gebraucht - Akzeptabel',
  USED_ACCEPTABLE: 'Gebraucht - Stark gebraucht',
  FOR_PARTS_OR_NOT_WORKING: 'Defekt / für Teile',
};

export const PRIVAT_HINWEIS = 'Privatverkauf, keine Garantie oder Rücknahme.';
export const AUCTION_DAYS = [1, 3, 5, 7, 10];
const CUR = 'EUR';
const money = (v) => ({ value: formatMoney(v), currency: CUR });

export function makeSku(now = Date.now()) {
  return `HELFER-${now.toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** Beschreibung als einfaches HTML (eBay akzeptiert HTML in listingDescription). */
export function buildDescriptionHtml(text, privat) {
  const parts = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (privat) parts.push(PRIVAT_HINWEIS);
  return parts.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/** Merkmale als eBay-Aspects: { Name: [Wert] } */
export function buildAspects(list = []) {
  const aspects = {};
  for (const m of list) {
    const n = String(m?.name ?? '').trim();
    const v = String(m?.wert ?? m?.value ?? '').trim();
    if (n && v) aspects[n] = [v];
  }
  return aspects;
}

export function buildInventoryItem(draft, imageUrls) {
  const item = {
    product: {
      title: truncateTitle(draft.titel, 80),
      description: buildDescriptionHtml(draft.beschreibung, draft.privat),
      aspects: buildAspects(draft.merkmale),
      imageUrls,
    },
    condition: draft.zustand || 'USED_GOOD',
    availability: { shipToLocationAvailability: { quantity: Math.max(1, parseInt(draft.verkauf?.menge, 10) || 1) } },
  };
  if (draft.zustandsbeschreibung) item.conditionDescription = String(draft.zustandsbeschreibung).slice(0, 1000);
  return item;
}

function num(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Verkaufsart -> Offer-Payload.
 * verkauf.art: 'festpreis' | 'auktion' | 'auktion_sofort'
 */
export function buildOfferPayload(draft, { sku, policies, merchantLocationKey, categoryId }) {
  const v = draft.verkauf || {};
  const art = v.art || 'festpreis';
  const qty = Math.max(1, parseInt(v.menge, 10) || 1);
  const listingPolicies = {
    fulfillmentPolicyId: policies.versand,
    paymentPolicyId: policies.zahlung,
    returnPolicyId: policies.rueckgabe,
  };
  const offer = {
    sku,
    marketplaceId: 'EBAY_DE',
    categoryId: String(categoryId),
    merchantLocationKey,
    listingDescription: buildDescriptionHtml(draft.beschreibung, draft.privat),
    listingPolicies,
  };

  if (art === 'festpreis') {
    const price = num(v.preis);
    if (!(price > 0)) throw new AppError(400, 'Preis fehlt', 'Bitte gib in Schritt 4 einen Festpreis ein.', { schritt: 4 });
    offer.format = 'FIXED_PRICE';
    offer.listingDuration = 'GTC';
    offer.availableQuantity = qty;
    offer.pricingSummary = { price: money(price) };
    if (v.preisvorschlag?.aktiv) {
      const terms = { bestOfferEnabled: true };
      const accept = num(v.preisvorschlag.annahmeAb);
      const decline = num(v.preisvorschlag.ablehnenUnter);
      if (accept > 0) {
        if (accept >= price + 0.001 && accept > price) throw new AppError(400, 'Preisvorschlag ungültig', 'Der Preis für die automatische Annahme darf nicht über dem Festpreis liegen.', { schritt: 4 });
        terms.autoAcceptPrice = money(accept);
      }
      if (decline > 0) {
        if (accept > 0 && decline >= accept) throw new AppError(400, 'Preisvorschlag ungültig', 'Der Ablehnungspreis muss unter dem Annahmepreis liegen.', { schritt: 4 });
        terms.autoDeclinePrice = money(decline);
      }
      listingPolicies.bestOfferTerms = terms;
    }
    return offer;
  }

  // Auktion (mit oder ohne Sofort-Kaufen)
  const start = num(v.startpreis);
  if (!(start > 0)) throw new AppError(400, 'Startpreis fehlt', 'Bitte gib in Schritt 4 einen Startpreis ein.', { schritt: 4 });
  const days = AUCTION_DAYS.includes(parseInt(v.dauerTage, 10)) ? parseInt(v.dauerTage, 10) : 7;
  offer.format = 'AUCTION';
  offer.listingDuration = `DAYS_${days}`;
  offer.availableQuantity = 1; // eBay-Auktionen: immer genau 1 Stück
  offer.pricingSummary = { auctionStartPrice: money(start) };
  const reserve = num(v.reservePreis);
  if (reserve > 0) offer.pricingSummary.auctionReservePrice = money(reserve);
  if (art === 'auktion_sofort') {
    const bin = num(v.sofortpreis);
    if (!(bin > 0)) throw new AppError(400, 'Sofort-Kaufen-Preis fehlt', 'Bitte gib in Schritt 4 den Sofort-Kaufen-Preis ein.', { schritt: 4 });
    if (bin <= start) throw new AppError(400, 'Sofort-Kaufen-Preis zu niedrig', 'Der Sofort-Kaufen-Preis muss höher als der Startpreis sein.', { schritt: 4 });
    offer.pricingSummary.price = money(bin);
  }
  return offer;
}

const inv = () => `${hosts().api}/sell/inventory/v1`;

export async function putInventoryItem(sku, payload) {
  const token = await getUserToken();
  await ebayFetch(`${inv()}/inventory_item/${encodeURIComponent(sku)}`, { method: 'PUT', token, json: payload });
}

export async function createOffer(payload) {
  const token = await getUserToken();
  const d = await ebayFetch(`${inv()}/offer`, { method: 'POST', token, json: payload });
  return d.offerId;
}

export async function publishOffer(offerId) {
  const token = await getUserToken();
  const d = await ebayFetch(`${inv()}/offer/${offerId}/publish`, { method: 'POST', token });
  return d.listingId;
}

export function listingUrl(listingId) {
  return `${hosts().site}/itm/${listingId}`;
}

export async function listLocations() {
  const token = await getUserToken();
  const d = await ebayFetch(`${inv()}/location?limit=20`, { token });
  return (d.locations || []).map((l) => ({
    key: l.merchantLocationKey,
    name: l.name || l.merchantLocationKey,
    ort: [l.location?.address?.postalCode, l.location?.address?.city].filter(Boolean).join(' '),
  }));
}

export async function createLocation({ plz, ort, land = 'DE', name = 'Mein Standort' }) {
  const token = await getUserToken();
  const key = 'helfer-standort';
  await ebayFetch(`${inv()}/location/${key}`, {
    method: 'POST',
    token,
    json: {
      name,
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
      location: { address: { postalCode: plz, city: ort, country: land } },
    },
  });
  return key;
}
