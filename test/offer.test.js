import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfferPayload, buildInventoryItem, buildAspects, buildDescriptionHtml } from '../src/ebay/inventory.js';
import { AppError } from '../src/util.js';

const ctx = { sku: 'SKU1', policies: { versand: 'F1', zahlung: 'P1', rueckgabe: 'R1' }, merchantLocationKey: 'loc', categoryId: 33615 };
const base = { beschreibung: 'Text', privat: false };

test('Festpreis -> FIXED_PRICE, GTC, Preis als String mit 2 Stellen', () => {
  const o = buildOfferPayload({ ...base, verkauf: { art: 'festpreis', preis: '24,5', menge: 2 } }, ctx);
  assert.equal(o.format, 'FIXED_PRICE');
  assert.equal(o.listingDuration, 'GTC');
  assert.equal(o.availableQuantity, 2);
  assert.deepEqual(o.pricingSummary, { price: { value: '24.50', currency: 'EUR' } });
  assert.equal(o.marketplaceId, 'EBAY_DE');
  assert.equal(o.categoryId, '33615');
  assert.equal(o.merchantLocationKey, 'loc');
  assert.deepEqual(o.listingPolicies, { fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1' });
});

test('Festpreis mit Preisvorschlag (Best Offer) inkl. Auto-Annahme/-Ablehnung', () => {
  const o = buildOfferPayload({ ...base, verkauf: { art: 'festpreis', preis: 50, preisvorschlag: { aktiv: true, annahmeAb: 45, ablehnenUnter: 30 } } }, ctx);
  assert.deepEqual(o.listingPolicies.bestOfferTerms, {
    bestOfferEnabled: true,
    autoAcceptPrice: { value: '45.00', currency: 'EUR' },
    autoDeclinePrice: { value: '30.00', currency: 'EUR' },
  });
});

test('Preisvorschlag ohne Mindestpreise: nur bestOfferEnabled', () => {
  const o = buildOfferPayload({ ...base, verkauf: { art: 'festpreis', preis: 50, preisvorschlag: { aktiv: true } } }, ctx);
  assert.deepEqual(o.listingPolicies.bestOfferTerms, { bestOfferEnabled: true });
});

test('Auktion -> AUCTION, DAYS_n, Menge 1, Startpreis, optional Reserve', () => {
  const o = buildOfferPayload({ ...base, verkauf: { art: 'auktion', startpreis: 1, dauerTage: 5, reservePreis: 20, menge: 4 } }, ctx);
  assert.equal(o.format, 'AUCTION');
  assert.equal(o.listingDuration, 'DAYS_5');
  assert.equal(o.availableQuantity, 1);
  assert.deepEqual(o.pricingSummary, { auctionStartPrice: { value: '1.00', currency: 'EUR' }, auctionReservePrice: { value: '20.00', currency: 'EUR' } });
  assert.equal(o.listingPolicies.bestOfferTerms, undefined);
});

test('Auktion + Sofort-Kaufen: price = Sofortpreis; ungültige Dauer -> 7 Tage', () => {
  const o = buildOfferPayload({ ...base, verkauf: { art: 'auktion_sofort', startpreis: 5, sofortpreis: 40, dauerTage: 4 } }, ctx);
  assert.equal(o.listingDuration, 'DAYS_7');
  assert.equal(o.pricingSummary.price.value, '40.00');
  assert.equal(o.pricingSummary.auctionStartPrice.value, '5.00');
});

test('Validierung: Sofortpreis muss über Startpreis liegen; Festpreis fehlt', () => {
  assert.throws(() => buildOfferPayload({ ...base, verkauf: { art: 'auktion_sofort', startpreis: 10, sofortpreis: 10 } }, ctx), AppError);
  assert.throws(() => buildOfferPayload({ ...base, verkauf: { art: 'festpreis' } }, ctx), /Festpreis/);
});

test('Inventory-Item: Titel gekürzt, Aspekte, Zustand, Menge', () => {
  const item = buildInventoryItem({ titel: 'x'.repeat(120), beschreibung: 'A\n\nB', privat: true, zustand: 'USED_EXCELLENT', merkmale: [{ name: 'Marke', wert: 'ATE' }, { name: '', wert: 'leer' }], verkauf: { menge: 3 } }, ['https://i/1.jpg']);
  assert.equal(item.product.title.length, 80);
  assert.deepEqual(item.product.aspects, { Marke: ['ATE'] });
  assert.equal(item.condition, 'USED_EXCELLENT');
  assert.equal(item.availability.shipToLocationAvailability.quantity, 3);
  assert.match(item.product.description, /Privatverkauf, keine Garantie oder Rücknahme/);
  assert.deepEqual(item.product.imageUrls, ['https://i/1.jpg']);
});

test('Beschreibung wird HTML-escaped', () => {
  assert.equal(buildDescriptionHtml('<b>x</b>', false), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.deepEqual(buildAspects([{ name: 'A', wert: 'b' }]), { A: ['b'] });
});
