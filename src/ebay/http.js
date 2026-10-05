// Dünner fetch-Wrapper für alle eBay-Aufrufe.
import { getConfig } from '../config.js';
import { translateEbayErrors } from './errors.js';

export function hosts() {
  const sandbox = getConfig().ebayEnv !== 'production';
  return {
    sandbox,
    api: sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com',
    media: sandbox ? 'https://apim.sandbox.ebay.com' : 'https://apim.ebay.com',
    auth: sandbox ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com',
    site: sandbox ? 'https://www.sandbox.ebay.de' : 'https://www.ebay.de',
  };
}

export class EbayError extends Error {
  constructor(status, errors, raw) {
    super(`eBay-Fehler ${status}`);
    this.status = status;
    this.errors = errors || [];
    this.raw = raw;
    this.explained = translateEbayErrors(status, this.errors);
  }
}

/**
 * @param {string} url vollständige URL
 * @param {object} o { method, token, json, body, headers, expect: 'json'|'response' }
 */
export async function ebayFetch(url, o = {}) {
  const headers = {
    Accept: 'application/json',
    'Accept-Language': 'de-DE',
    ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
    ...(o.headers || {}),
  };
  let body = o.body;
  if (o.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Language'] = headers['Content-Language'] || 'de-DE';
    body = JSON.stringify(o.json);
  }
  let res;
  try {
    res = await fetch(url, { method: o.method || 'GET', headers, body, signal: AbortSignal.timeout(o.timeout || 60000) });
  } catch (e) {
    throw new EbayError(0, [{ message: `Netzwerkfehler: ${e.message}` }]);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const errors = data?.errors || (data?.error ? [{ message: data.error_description || data.error, errorId: data.error }] : [{ message: text.slice(0, 300) }]);
    throw new EbayError(res.status, errors, data);
  }
  return o.expect === 'response' ? { res, data } : data;
}
