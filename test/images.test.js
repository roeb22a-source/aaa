import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { enhanceImage, blurSigma } from '../src/images.js';

async function testImage(w = 2400, h = 1800) {
  // Rotes Objekt mit feinem Schachbrett in der Mitte, Rand mit feinem Streifenmuster (hohe Detailfülle)
  let stripes = '';
  for (let x = 0; x < w; x += 8) stripes += `<rect x="${x}" y="0" width="4" height="${h}" fill="#222"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ddd"/>${stripes}
    <circle cx="${w / 2}" cy="${h / 2}" r="${h / 4}" fill="#c22"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}
async function detail(buf, left, top, width, height) {
  const part = await sharp(buf).extract({ left, top, width, height }).greyscale().png().toBuffer();
  const { channels } = await sharp(part).stats();
  return channels[0].stdev;
}

test('blurSigma: 0 = aus, 50 ≈ 15', () => {
  assert.equal(blurSigma(0), 0);
  assert.equal(blurSigma(50), 15);
});

test('Verbesserung mit Fallback-Blur: max. 1600px, JPEG, Rand unscharf, Mitte scharf', async () => {
  const input = await testImage();
  const r = await enhanceImage(input, { blur: 50, segmenter: null });
  assert.equal(r.method, 'fokus-blur');
  const meta = await sharp(r.buffer).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(Math.max(meta.width, meta.height), 1600);
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 1200);
  const w = meta.width, h = meta.height;
  const edgeBefore = await detail(await sharp(input).resize(w, h).toBuffer(), 150, 100, 120, 120);
  const edgeAfter = await detail(r.buffer, 150, 100, 120, 120);
  assert.ok(edgeAfter < edgeBefore * 0.5, `Rand muss deutlich unschärfer sein (${edgeAfter} vs ${edgeBefore})`);
});

test('Fehlschlagende Freistellung -> Fallback, kein Absturz, Hinweis gesetzt', async () => {
  const input = await testImage(800, 600);
  const r = await enhanceImage(input, { blur: 40, segmenter: async () => { throw new Error('Modell nicht verfügbar'); } });
  assert.equal(r.method, 'fokus-blur');
  assert.match(r.note, /Freistellung nicht möglich/);
  assert.equal((await sharp(r.buffer).metadata()).width, 800);
});

test('Freistellung mit Maske (Segmenter-Stub) -> Methode "freistellung" + Maske zum Cachen', async () => {
  const input = await testImage(800, 600);
  const maskStub = async () => sharp(Buffer.from(`<svg width="800" height="600"><rect width="800" height="600" fill="black"/><circle cx="400" cy="300" r="150" fill="white"/></svg>`)).removeAlpha().greyscale().png().toBuffer();
  const r = await enhanceImage(input, { blur: 50, segmenter: maskStub });
  assert.equal(r.method, 'freistellung');
  assert.ok(r.maskPng);
  const again = await enhanceImage(input, { blur: 80, segmenter: null, cachedMask: r.maskPng });
  assert.equal(again.method, 'freistellung');
});

test('Unplausible Maske (alles Hintergrund) -> Fallback', async () => {
  const input = await testImage(400, 300);
  const empty = async () => sharp({ create: { width: 400, height: 300, channels: 1, background: 0 } }).png().toBuffer();
  const r = await enhanceImage(input, { segmenter: empty });
  assert.equal(r.method, 'fokus-blur');
});

test('Blur 0 -> nur Verbesserung', async () => {
  const r = await enhanceImage(await testImage(500, 400), { blur: 0, segmenter: null });
  assert.equal(r.method, 'ohne-blur');
});
