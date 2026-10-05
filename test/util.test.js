import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateTitle } from '../src/util.js';
import { priceStats } from '../src/ebay/browse.js';
import { translateEbayErrors } from '../src/ebay/errors.js';

test('Titel-Kürzung: kurze Titel bleiben unverändert', () => {
  assert.equal(truncateTitle('VW Golf 4 Bremssattel vorne links'), 'VW Golf 4 Bremssattel vorne links');
});

test('Titel-Kürzung: max. 80 Zeichen, an Wortgrenze, ohne Schlusszeichen', () => {
  const long = 'VW Golf 4 Bremssattel vorne links Original ATE 1J0615123 mit Bremsbelägen - sehr guter Zustand TOP';
  const t = truncateTitle(long, 80);
  assert.ok(t.length <= 80, `Länge ${t.length}`);
  assert.ok(long.startsWith(t));
  assert.doesNotMatch(t, /[\s-]$/);
  assert.ok(!t.endsWith('Zusta'), 'nicht mitten im Wort schneiden');
});

test('Titel-Kürzung: Wort ohne Leerzeichen wird hart gekürzt, Whitespace normalisiert', () => {
  assert.equal(truncateTitle('a'.repeat(100), 80).length, 80);
  assert.equal(truncateTitle('  a   b \n c '), 'a b c');
});

test('Preisstatistik: Min/Median/Max/Anzahl', () => {
  const s = priceStats([
    { price: { value: '10.00', currency: 'EUR' } },
    { price: { value: '30.00', currency: 'EUR' } },
    { price: { value: '20.00', currency: 'EUR' } },
    { price: { value: '99.00', currency: 'USD' } },
    { price: { value: 'abc', currency: 'EUR' } },
    {},
  ]);
  assert.deepEqual(s, { anzahl: 3, min: 10, median: 20, max: 30, durchschnitt: 20 });
});

test('Preisstatistik: gerade Anzahl -> Mittel der mittleren Werte; leer -> null', () => {
  const s = priceStats([10, 20, 30, 50].map((v) => ({ price: { value: String(v), currency: 'EUR' } })));
  assert.equal(s.median, 25);
  assert.equal(priceStats([]), null);
});

test('eBay-Fehler: fehlende Artikelmerkmale führen zu Schritt 3', () => {
  const r = translateEbayErrors(400, [{ errorId: 25002, message: 'The item specific Marke is missing.' }]);
  assert.equal(r.schritt, 3);
  assert.match(r.titel, /Artikelmerkmale/);
});

test('eBay-Fehler: 401 -> Einstellungen', () => {
  assert.equal(translateEbayErrors(401, [{ message: 'Invalid access token' }]).einstellungen, true);
});
