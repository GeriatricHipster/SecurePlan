import { Router } from 'express';
import crypto from 'node:crypto';
import { hashInviteCode, hashPassword, setAuthCookie, clearAuthCookie, signSession, verifyPassword, publicUser } from '../lib/auth.js';
import { conflict, unauthorized, forbidden } from '../lib/errors.js';
import { emailValue, passwordValue, stringValue } from '../lib/validation.js';
import { seedOwnerDemo, logSecurityEvent } from '../db.js';

export function createAuthRouter({ db, config, auth, disconnectUser }) {
  const router = Router();

  router.get('/bootstrap', auth.optionalAuth, async (req, res) => {
    const userCount = Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count);
    const setupCodeRequired = userCount === 0 && (Boolean(config.setupCode) || config.nodeEnv === 'production');
    res.json({
      data: {
        setupRequired: userCount === 0,
        setupCodeRequired,
        authenticated: Boolean(req.user),
        user: publicUser(req.user),
      },
      setupRequired: userCount === 0,
      setupCodeRequired,
      user: publicUser(req.user),
    });
  });

  router.post('/auth/setup', async (req, res) => {
    if (config.nodeEnv === 'production' && config.setupCode.length < 16) {
      throw forbidden('Owner setup is disabled until SETUP_CODE is configured with at least 16 characters.');
    }
    if (config.setupCode && !sameSecret(req.body?.setupCode, config.setupCode)) {
      await logSecurityEvent(db, { eventType: 'setup_code.failed', severity: 'critical', req });
      throw forbidden('The owner setup code is incorrect.');
    }
    const name = stringValue(req.body?.name, 'name', { min: 2, max: 100 });
    const email = emailValue(req.body?.email);
    const password = passwordValue(req.body?.password);
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      role: 'owner',
      workspace_access: 1,
      token_version: 0,
      created_at: now,
      updated_at: now,
    };

    const setup = await db.transaction(async () => {
      if (Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count) > 0) {
        throw conflict('Owner setup has already been completed.');
      }
      await db.prepare(
        `INSERT INTO users
          (id, name, email, password_hash, role, workspace_access, token_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'owner', 1, 0, ?, ?)`,
      ).run(user.id, name, email, hashPassword(password), now, now);
      await seedOwnerDemo(db, user.id);
    });
    await setup();

    const sessionToken = signSession(user, config);
    setAuthCookie(res, sessionToken, config);
    sendAuthResponse(req, res, 201, user, sessionToken);
  });

  router.post('/auth/login', async (req, res) => {
    const email = emailValue(req.body?.email);
    const password = stringValue(req.body?.password, 'password', { min: 1, max: 200, trim: false });
    const user = await db.prepare('SELECT * FROM users WHERE email = ? AND disabled_at IS NULL').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      await logSecurityEvent(db, { eventType: 'login.failed', severity: 'warning', emailAttempted: email, req });
      throw unauthorized('Email or password is incorrect.');
    }
    await logSecurityEvent(db, { eventType: 'login.success', userId: user.id, req });
    const sessionToken = signSession(user, config);
    setAuthCookie(res, sessionToken, config);
    sendAuthResponse(req, res, 200, user, sessionToken);
  });

  router.post('/auth/register', async (req, res) => {
    const name = stringValue(req.body?.name, 'name', { min: 2, max: 100 });
    const email = emailValue(req.body?.email);
    const password = passwordValue(req.body?.password);
    const inviteCode = stringValue(req.body?.inviteCode, 'inviteCode', { min: 8, max: 80 }).toUpperCase();
    const now = new Date().toISOString();
    let userId = crypto.randomUUID();
    let user;

    const register = await db.transaction(async () => {
      const invitation = await db.prepare('SELECT * FROM invitations WHERE code_hash = ?').get(hashInviteCode(inviteCode));
      const expired = invitation?.expires_at && Date.parse(invitation.expires_at) <= Date.now();
      if (!invitation || invitation.revoked_at || expired || invitation.use_count >= invitation.max_uses) {
        throw forbidden('This invitation code is invalid, expired, revoked, or has already been used.');
      }
      if (invitation.email && invitation.email.toLowerCase() !== email) {
        throw forbidden('This invitation was issued to a different email address.');
      }

      const existing = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (existing && !existing.disabled_at) {
        throw conflict('An account already exists for this email address.', { field: 'email' });
      }
      if (existing?.disabled_at && !invitation.email) {
        throw forbidden('A removed account can only be restored with an invitation restricted to its email address.');
      }

      const globalRole = invitation.site_id ? 'viewer' : invitation.role;
      if (existing?.disabled_at) {
        userId = existing.id;
        await db.prepare('DELETE FROM site_members WHERE user_id = ?').run(userId);
        await db.prepare(
          `UPDATE users
              SET name = ?, password_hash = ?, role = ?, workspace_access = ?,
                  disabled_at = NULL, token_version = token_version + 1, updated_at = ?
            WHERE id = ?`,
        ).run(name, hashPassword(password), globalRole, invitation.site_id ? 0 : 1, now, userId);
      } else {
        await db.prepare(
          `INSERT INTO users
            (id, name, email, password_hash, role, workspace_access, token_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(userId, name, email, hashPassword(password), globalRole, invitation.site_id ? 0 : 1, now, now);
      }
      if (invitation.site_id) {
        await db.prepare(
          `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(invitation.site_id, userId, invitation.role, invitation.created_by, now, now);
      }
      await db.prepare('UPDATE invitations SET use_count = use_count + 1 WHERE id = ?').run(invitation.id);
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    });
    await register();

    const sessionToken = signSession(user, config);
    setAuthCookie(res, sessionToken, config);
    sendAuthResponse(req, res, 201, user, sessionToken);
  });

  router.get('/auth/me', auth.requireAuth, async (req, res) => {
    const sites = await db
      .prepare(
        `SELECT s.id, s.name, s.updated_at,
                CASE WHEN ? IN ('owner','admin') OR ? = 1 THEN ? ELSE sm.role END AS role
           FROM sites s
           LEFT JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = ?
          WHERE ? IN ('owner','admin') OR ? = 1 OR sm.user_id IS NOT NULL
          ORDER BY s.order_index, s.name`,
      )
      .all(
        req.user.role,
        req.user.workspace_access,
        req.user.role,
        req.user.id,
        req.user.role,
        req.user.workspace_access,
      );
    res.json({ data: { user: publicUser(req.user), sites }, user: publicUser(req.user) });
  });

  router.post('/auth/logout', auth.requireAuth, async (req, res) => {
    await db.prepare('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      req.user.id,
    );
    clearAuthCookie(res, config);
    disconnectUser(req.user.id);
    res.json({ data: { loggedOut: true }, success: true });
  });

  return router;
}

function sameSecret(candidate, expected) {
  const left = crypto.createHash('sha256').update(String(candidate || '')).digest();
  const right = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

function sendAuthResponse(req, res, status, user, sessionToken) {
  const data = { user: publicUser(user) };
  if (String(req.get('X-SecurePlan-Client') || '').trim().toLowerCase() === 'native') {
    data.sessionToken = sessionToken;
  }
  res.status(status).json({ data, user: data.user });
}
