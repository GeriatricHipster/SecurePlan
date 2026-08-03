import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv || process.env.NODE_ENV || 'development';
  const dataDir = path.resolve(
    overrides.dataDir || process.env.DATA_DIR || path.join(serverDirectory, '..', '.data'),
  );
  const uploadsDir = path.join(dataDir, 'uploads');
  const surveyFilesDir = path.join(uploadsDir, 'surveys');
  const photoFilesDir = path.join(uploadsDir, 'photos');
  const temporaryFilesDir = path.join(uploadsDir, 'tmp');

  for (const directory of [dataDir, uploadsDir, surveyFilesDir, photoFilesDir, temporaryFilesDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  }

  const jwtSecret = overrides.jwtSecret || process.env.JWT_SECRET || persistentSecret(dataDir);
  if (nodeEnv === 'production' && String(jwtSecret).length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  }
  const setupCode = overrides.setupCode !== undefined
    ? String(overrides.setupCode || '').trim()
    : String(process.env.SETUP_CODE || '').trim();

  const originInput =
    overrides.frontendOrigin ??
    process.env.APP_ORIGIN ??
    process.env.FRONTEND_ORIGIN ??
    process.env.RENDER_EXTERNAL_URL ??
    '';
  const frontendOrigin = normalizeOrigin(originInput, nodeEnv);
  const mobileOriginInput = overrides.mobileOrigins ?? process.env.MOBILE_ORIGINS ?? '';
  const mobileOrigins = normalizeMobileOrigins(mobileOriginInput, nodeEnv);
  const allowedOrigins = [...new Set([frontendOrigin, ...mobileOrigins].filter(Boolean))];

  return {
    nodeEnv,
    dataDir,
    databasePath: overrides.databasePath || path.join(dataDir, 'secureplan.sqlite'),
    uploadsDir,
    surveyFilesDir,
    photoFilesDir,
    temporaryFilesDir,
    jwtSecret,
    setupCode,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    cookieName: process.env.AUTH_COOKIE_NAME || 'secureplan_session',
    cookieSecure:
      overrides.cookieSecure ??
      booleanSetting(process.env.COOKIE_SECURE, nodeEnv === 'production', 'COOKIE_SECURE'),
    frontendOrigin,
    mobileOrigins,
    allowedOrigins,
    trustProxy: parseTrustProxy(overrides.trustProxy ?? process.env.TRUST_PROXY, nodeEnv === 'production' ? 1 : false),
    staticDir: path.resolve(
      overrides.staticDir || process.env.STATIC_DIR || path.join(serverDirectory, '..', 'dist'),
    ),
    maxPdfBytes: boundedNumber(overrides.maxPdfBytes ?? process.env.MAX_PDF_BYTES, 75 * 1024 * 1024, 1, 1024 ** 3, 'MAX_PDF_BYTES'),
    maxPhotoBytes: boundedNumber(overrides.maxPhotoBytes ?? process.env.MAX_PHOTO_BYTES, 20 * 1024 * 1024, 1, 250 * 1024 * 1024, 'MAX_PHOTO_BYTES'),
    minFreeStorageBytes: boundedNumber(
      overrides.minFreeStorageBytes ?? process.env.MIN_FREE_STORAGE_BYTES,
      1024 * 1024,
      0,
      Number.MAX_SAFE_INTEGER,
      'MIN_FREE_STORAGE_BYTES',
    ),
  };
}

function normalizeOrigin(value, nodeEnv) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('APP_ORIGIN must be a complete http:// or https:// origin.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('APP_ORIGIN must be a complete http:// or https:// origin without credentials.');
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  return url.origin;
}

function normalizeMobileOrigins(value, nodeEnv) {
  const origins = Array.isArray(value) ? value : String(value || '').split(',');
  return origins
    .map((origin) => String(origin).trim())
    .filter(Boolean)
    .map((origin) => normalizeMobileOrigin(origin, nodeEnv));
}

function normalizeMobileOrigin(value, nodeEnv) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Every MOBILE_ORIGINS entry must be a complete origin.');
  }
  if (url.username || url.password || url.search || url.hash || !url.host || !['', '/'].includes(url.pathname)) {
    throw new Error('Every MOBILE_ORIGINS entry must be an origin without credentials, path, query, or fragment.');
  }
  if (['http:', 'https:'].includes(url.protocol)) return normalizeOrigin(value, nodeEnv);
  if (!['capacitor:', 'ionic:'].includes(url.protocol)) {
    throw new Error('MOBILE_ORIGINS entries must use https://, capacitor://, or ionic://.');
  }
  return `${url.protocol}//${url.host}`;
}

function booleanSetting(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true or false.`);
}

function boundedNumber(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function parseTrustProxy(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  throw new Error('TRUST_PROXY must be true, false, or a non-negative integer hop count.');
}

function persistentSecret(dataDir) {
  const secretPath = path.join(dataDir, '.jwt-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return secret;
  } catch (error) {
    // A second process may have won first-start initialization between read and write.
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length < 32) throw new Error('The persisted JWT secret is invalid.');
    return existing;
  }
}
