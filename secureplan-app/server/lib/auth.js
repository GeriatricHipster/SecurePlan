import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from './errors.js';

const ROLE_RANK = Object.freeze({ viewer: 0, installer: 1, editor: 2, manager: 3, admin: 4, owner: 5 });

export const SITE_ROLES = ['viewer', 'installer', 'editor', 'manager', 'admin'];
export const USER_ROLES = ['viewer', 'installer', 'editor', 'manager', 'admin', 'owner'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, saltText, hashText] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashInviteCode(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

export function createInviteCode() {
  const compact = crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[_-]/g, 'X');
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

export function createResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function signSession(user, config) {
  return jwt.sign({ sub: user.id, tokenVersion: user.token_version || 0 }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    issuer: 'secureplan',
    audience: 'secureplan-web',
  });
}

export function verifySession(token, config) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'secureplan', audience: 'secureplan-web' });
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    try {
      result[key] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // Ignore malformed cookies.
    }
  }
  return result;
}

export function setAuthCookie(res, token, config) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res, config) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  });
}

export function createAuthMiddleware(db, config) {
  async function resolveUserFromToken(token) {
    if (!token) return null;
    try {
      const payload = verifySession(token, config);
      const user = await db
        .prepare(
          `SELECT id, name, email, role, workspace_access, token_version, created_at, updated_at
             FROM users WHERE id = ? AND disabled_at IS NULL`,
        )
        .get(payload.sub);
      if (!user || Number(payload.tokenVersion) !== Number(user.token_version)) return null;
      return user;
    } catch {
      return null;
    }
  }

  async function optionalAuth(req, _res, next) {
    const authorization = req.headers.authorization;
    let token;
    if (authorization !== undefined) {
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(String(authorization));
      token = match?.[1] || null;
    } else {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies[config.cookieName];
    }
    req.user = await resolveUserFromToken(token);
    return next();
  }

  async function requireAuth(req, _res, next) {
    await optionalAuth(req, null, () => {});
    if (!req.user) return next(unauthorized());
    return next();
  }

  function requireGlobalRole(minimumRole) {
    return (req, _res, next) => {
      if (!req.user) return next(unauthorized());
      if (!hasRole(req.user.role, minimumRole)) return next(forbidden());
      next();
    };
  }

  return { optionalAuth, requireAuth, requireGlobalRole, resolveUserFromToken };
}

export function hasRole(actual, minimum) {
  return (ROLE_RANK[actual] ?? -1) >= (ROLE_RANK[minimum] ?? Number.POSITIVE_INFINITY);
}

export async function siteRole(db, user, siteId) {
  if (!user) return null;
  if (user.role === 'owner' || user.role === 'admin' || user.workspace_access) return user.role;
  return (await db.prepare('SELECT role FROM site_members WHERE site_id = ? AND user_id = ?').get(siteId, user.id))?.role || null;
}

export async function assertSiteAccess(db, user, siteId, minimumRole = 'viewer') {
  const role = await siteRole(db, user, siteId);
  if (!role) throw forbidden('You do not have access to this site.');
  if (!hasRole(role, minimumRole)) throw forbidden();
  return role;
}

export async function assertSurveyAssignment(db, user, role, surveyId) {
  if (role !== 'viewer' && role !== 'installer') return;
  const assignment = await db
    .prepare('SELECT 1 FROM survey_assignments WHERE survey_id = ? AND user_id = ?')
    .get(surveyId, user.id);
  if (!assignment) throw forbidden('You are not assigned to this survey.');
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    workspaceAccess: Boolean(user.workspace_access),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
