// Konfiguration: .env hat Vorrang vor data/config.json. Geheimnisse verlassen nie das Backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ENV_MAP = {
  ebayClientId: 'EBAY_CLIENT_ID',
  ebayCertId: 'EBAY_CERT_ID',
  ebayRuName: 'EBAY_RU_NAME',
  ebayEnv: 'EBAY_ENV',
  anthropicKey: 'ANTHROPIC_API_KEY',
  claudeModel: 'CLAUDE_MODEL',
};
const SECRET_FIELDS = ['ebayClientId', 'ebayCertId', 'anthropicKey'];
const EDITABLE = ['ebayClientId', 'ebayCertId', 'ebayRuName', 'ebayEnv', 'anthropicKey'];

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeFile(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
}

export function getConfig() {
  const file = readFile();
  const cfg = { ...file };
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    if (process.env[envName]) cfg[key] = process.env[envName];
  }
  cfg.ebayEnv = cfg.ebayEnv === 'production' ? 'production' : 'sandbox';
  cfg.claudeModel = cfg.claudeModel || 'claude-sonnet-5-5';
  cfg.forceDemo = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
  return cfg;
}

export function saveConfig(patch = {}, clear = []) {
  const file = readFile();
  for (const key of EDITABLE) {
    const v = patch[key];
    if (typeof v === 'string' && v.trim() !== '') file[key] = v.trim();
  }
  for (const key of clear) if (EDITABLE.includes(key)) delete file[key];
  writeFile(file);
}

export function saveTokens(tokens) {
  const file = readFile();
  file.tokens = tokens;
  writeFile(file);
}

export function saveExtra(key, value) {
  const file = readFile();
  file[key] = value;
  writeFile(file);
}

export function publicConfig() {
  const cfg = getConfig();
  const out = {
    ebayRuName: cfg.ebayRuName || '',
    ebayEnv: cfg.ebayEnv,
    claudeModel: cfg.claudeModel,
    secrets: {},
    fromEnv: {},
  };
  for (const key of SECRET_FIELDS) {
    out.secrets[key] = Boolean(cfg[key]);
  }
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    out.fromEnv[key] = Boolean(process.env[envName]);
  }
  out.ebayConnected = Boolean(cfg.tokens?.refresh_token);
  return out;
}

export function hasEbayApp() {
  const c = getConfig();
  return Boolean(c.ebayClientId && c.ebayCertId);
}
export function hasAnthropic() {
  return Boolean(getConfig().anthropicKey);
}
export function ebayConnected() {
  const c = getConfig();
  return Boolean(c.ebayClientId && c.ebayCertId && c.tokens?.refresh_token);
}
export function isDemoPublish() {
  return getConfig().forceDemo || !ebayConnected();
}
export function isDemoAi() {
  return getConfig().forceDemo || !hasAnthropic();
}
