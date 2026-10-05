// Kleine, reine Hilfsfunktionen (gut testbar).
export class AppError extends Error {
  constructor(status, titel, text, extra = {}) {
    super(text);
    this.status = status;
    this.titel = titel;
    this.text = text;
    Object.assign(this, extra);
  }
}

/** Kürzt einen Titel auf max. Zeichen, bevorzugt an einer Wortgrenze. */
export function truncateTitle(title, max = 80) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace >= Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s\-–,;:/|+&]+$/u, '');
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(v) {
  return Number(v).toFixed(2);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
