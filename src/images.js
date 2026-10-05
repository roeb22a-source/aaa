// Bildverbesserung: Auto-Rotation, Kontrast, Sättigung, Schärfe, Hintergrund-Unschärfe.
import sharp from 'sharp';

export const MAX_EDGE = 1600;
const SEG_EDGE = 1024;
const SEG_TIMEOUT_MS = 90_000;

/** Slider 0..100 -> Gauss-Sigma. 0 = keine Unschärfe, 50 ≈ 15. */
export function blurSigma(strength) {
  const s = Math.max(0, Math.min(100, Number(strength)));
  if (!Number.isFinite(s) || s === 0) return 0;
  return Math.max(0.5, (s / 50) * 15);
}

let segLoader = null;
let queue = Promise.resolve();

/** Standard-Segmentierer: @imgly/background-removal-node. Liefert Alpha-Maske (PNG-Buffer, einkanalig). */
export async function imglySegmenter(rgbPng) {
  const run = async () => {
    segLoader ||= import('@imgly/background-removal-node');
    const mod = await segLoader;
    const remove = mod.removeBackground || mod.default?.removeBackground || mod.default;
    const work = remove(new Blob([rgbPng], { type: 'image/png' }), { output: { format: 'image/png' }, debug: false });
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('Zeitüberschreitung')), SEG_TIMEOUT_MS);
    });
    try {
      const blob = await Promise.race([work, timeout]);
      const out = Buffer.from(await blob.arrayBuffer());
      return await sharp(out).ensureAlpha().extractChannel('alpha').png().toBuffer();
    } finally {
      clearTimeout(timer);
    }
  };
  // Nur eine Freistellung gleichzeitig (Speicher schonen)
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function baseImage(input) {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .normalise({ lower: 1, upper: 99 })
    .modulate({ saturation: 1.1 })
    .sharpen({ sigma: 0.9, m1: 0.8, m2: 2 })
    .toBuffer();
}

function ellipseMask(w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.round(Math.min(w, h) * 0.07)}"/></filter></defs>
    <rect width="100%" height="100%" fill="black"/>
    <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * 0.36}" ry="${h * 0.36}" fill="white" filter="url(#b)"/></svg>`;
  return sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer();
}

async function segmentationMask(baseBuf, w, h, segmenter) {
  const small = await sharp(baseBuf).resize(SEG_EDGE, SEG_EDGE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const maskPng = await segmenter(small);
  const raw = await sharp(maskPng).resize(w, h, { fit: 'fill' }).greyscale().blur(1.2).raw().toBuffer();
  let sum = 0;
  let n = 0;
  for (let i = 0; i < raw.length; i += 7) {
    sum += raw[i];
    n++;
  }
  const coverage = sum / (n * 255);
  if (coverage < 0.03 || coverage > 0.97) throw new Error(`Maske unplausibel (Anteil ${(coverage * 100).toFixed(0)} %)`);
  return raw;
}

/**
 * @param {Buffer} input Originalbild
 * @param {{blur?: number, segmenter?: Function|null, cachedMask?: Buffer|null}} opts
 * @returns {{buffer: Buffer, method: 'freistellung'|'fokus-blur'|'ohne-blur', width, height, maskPng?: Buffer, note?: string}}
 */
export async function enhanceImage(input, { blur = 50, segmenter = imglySegmenter, cachedMask = null } = {}) {
  const base = await baseImage(input);
  const { width: w, height: h } = await sharp(base).metadata();
  const sigma = blurSigma(blur);

  if (sigma === 0) {
    const buffer = await sharp(base).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return { buffer, method: 'ohne-blur', width: w, height: h };
  }

  let maskRaw = null;
  let method = 'freistellung';
  let note;
  let maskPng;
  if (cachedMask) {
    try {
      maskRaw = await sharp(cachedMask).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer();
    } catch {
      maskRaw = null;
    }
  }
  if (!maskRaw && segmenter) {
    try {
      maskRaw = await segmentationMask(base, w, h, segmenter);
      maskPng = await sharp(maskRaw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
    } catch (e) {
      note = `Freistellung nicht möglich (${e.message}). Stattdessen wurde eine Fokus-Unschärfe verwendet.`;
      maskRaw = null;
    }
  }
  if (!maskRaw) {
    method = 'fokus-blur';
    maskRaw = await ellipseMask(w, h);
  }

  const blurred = await sharp(base).blur(sigma).toBuffer();
  const rgb = await sharp(base).raw().toBuffer();
  const fg = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(maskRaw, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const buffer = await sharp(blurred).composite([{ input: fg, blend: 'over' }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buffer, method, width: w, height: h, maskPng, note };
}

export async function toAnalysisJpeg(input, edge = 1024) {
  return sharp(input, { failOn: 'none' }).rotate().resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
