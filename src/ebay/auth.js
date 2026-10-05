// OAuth: Application Token (Client Credentials) und User Token (Authorization Code + Refresh).
import crypto from 'node:crypto';
import { getConfig, saveTokens } from '../config.js';
import { ebayFetch, hosts, EbayError } from './http.js';

const SCOPE_BASE = 'https://api.ebay.com/oauth/api_scope';
export const USER_SCOPES = [
  SCOPE_BASE,
  `${SCOPE_BASE}/sell.inventory`,
  `${SCOPE_BASE}/sell.account`,
  `${SCOPE_BASE}/sell.fulfillment`,
];

function basicAuth() {
  const { ebayClientId, ebayCertId } = getConfig();
  if (!ebayClientId || !ebayCertId) {
    throw new EbayError(401, [{ message: 'App ID oder Cert ID fehlen', errorId: 'invalid_grant' }]);
  }
  return 'Basic ' + Buffer.from(`${ebayClientId}:${ebayCertId}`).toString('base64');
}

async function tokenRequest(params) {
  return ebayFetch(`${hosts().api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

let appToken = null;
export async function getAppToken() {
  if (appToken && appToken.expires > Date.now() + 60_000 && appToken.env === getConfig().ebayEnv) return appToken.value;
  const d = await tokenRequest({ grant_type: 'client_credentials', scope: SCOPE_BASE });
  appToken = { value: d.access_token, expires: Date.now() + d.expires_in * 1000, env: getConfig().ebayEnv };
  return appToken.value;
}

const pendingStates = new Map();
export function buildAuthUrl() {
  const { ebayClientId, ebayRuName } = getConfig();
  if (!ebayClientId || !ebayRuName) return null;
  const state = crypto.randomBytes(12).toString('hex');
  pendingStates.set(state, Date.now() + 15 * 60_000);
  const q = new URLSearchParams({
    client_id: ebayClientId,
    response_type: 'code',
    redirect_uri: ebayRuName,
    scope: USER_SCOPES.join(' '),
    state,
    prompt: 'login',
  });
  return `${hosts().auth}/oauth2/authorize?${q}`;
}

export function checkState(state) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

function storeTokens(d, old = {}) {
  const now = Date.now();
  saveTokens({
    access_token: d.access_token,
    expires: now + d.expires_in * 1000,
    refresh_token: d.refresh_token || old.refresh_token,
    refresh_expires: d.refresh_token_expires_in ? now + d.refresh_token_expires_in * 1000 : old.refresh_expires,
    env: getConfig().ebayEnv,
  });
}

/** Akzeptiert den reinen Code oder die komplette Weiterleitungs-URL. */
export function extractCode(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/[?&]code=([^&\s]+)/);
  if (m) s = m[1];
  try {
    s = decodeURIComponent(s);
  } catch {
    /* schon dekodiert */
  }
  return s;
}

export async function exchangeCode(codeInput) {
  const code = extractCode(codeInput);
  if (!code) throw new EbayError(400, [{ message: 'Kein Code angegeben' }]);
  const d = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: getConfig().ebayRuName });
  storeTokens(d);
}

let refreshing = null;
export async function getUserToken() {
  const t = getConfig().tokens;
  if (!t?.refresh_token) throw new EbayError(401, [{ message: 'Nicht mit eBay verbunden', errorId: 'invalid_grant' }]);
  if (t.access_token && t.expires > Date.now() + 60_000 && t.env === getConfig().ebayEnv) return t.access_token;
  if (!refreshing) {
    refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: USER_SCOPES.join(' ') })
      .then((d) => {
        storeTokens(d, t);
        return d.access_token;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export function disconnect() {
  saveTokens(null);
}
