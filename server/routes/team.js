import { Router } from 'express';
import crypto from 'node:crypto';
import { assertSiteAccess, createInviteCode, hashInviteCode, hasRole, SITE_ROLES } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getSite } from '../lib/resources.js';
import { serializeInvitation, serializeMember } from '../lib/serializers.js';
import { emailValue, enumValue, idValue, numberValue, optionalNullableString } from '../lib/validation.js';

export function createTeamRouter({ db, auth, emitSiteUpdate, disconnectUser }) {
  const router = Router();
  router.use(auth.requireAuth);

  const listMembers = async (req, res) => {
    const siteId = optionalNullableString(req.query.siteId, 'siteId', 80);
    let rows;
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'manager');
      rows = await db
        .prepare(
          `SELECT u.id, u.name, u.email, u.role AS global_role, u.created_at,
                  sm.site_id, sm.role AS site_role
             FROM site_members sm JOIN users u ON u.id = sm.user_id
            WHERE sm.site_id = ? AND u.disabled_at IS NULL
            ORDER BY u.name COLLATE NOCASE`,
        )
        .all(siteId);
    } else {
      requireWorkspaceAdmin(req.user);
      rows = await db
        .prepare(
          `SELECT u.id, u.name, u.email, u.role AS global_role, u.workspace_access,
                  u.created_at, NULL AS site_id, NULL AS site_role
             FROM users u WHERE u.disabled_at IS NULL ORDER BY u.name COLLATE NOCASE`,
        )
        .all();
    }
    const members = rows.map(serializeMember);
    res.json({ data: members, members, team: members });
  };
  router.get('/members', listMembers);
  router.get('/team', listMembers);

  const listInvitations = async (req, res) => {
    const siteId = optionalNullableString(req.query.siteId, 'siteId', 80);
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'manager');
    } else {
      requireWorkspaceAdmin(req.user);
    }
    const now = new Date().toISOString();
    const rows = siteId
      ? await db
          .prepare(
            `SELECT i.*, s.name AS site_name FROM invitations i
              LEFT JOIN sites s ON s.id = i.site_id
             WHERE i.site_id = ? AND i.revoked_at IS NULL AND i.use_count < i.max_uses
               AND (i.expires_at IS NULL OR i.expires_at > ?)
              ORDER BY i.created_at DESC`,
          )
          .all(siteId, now)
      : await db
          .prepare(
            `SELECT i.*, s.name AS site_name FROM invitations i
              LEFT JOIN sites s ON s.id = i.site_id
             WHERE i.revoked_at IS NULL AND i.use_count < i.max_uses
               AND (i.expires_at IS NULL OR i.expires_at > ?)
             ORDER BY i.created_at DESC`,
          )
          .all(now);
    const invitations = rows.map(serializeInvitation);
    res.json({ data: invitations, invitations, invites: invitations });
  };
  router.get('/invitations', listInvitations);
  router.get('/invites', listInvitations);

  const createInvitation = async (req, res) => {
    const siteId = optionalNullableString(req.body?.siteId, 'siteId', 80) ?? null;
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'manager');
    } else {
      requireWorkspaceAdmin(req.user);
    }
    const role = enumValue(req.body?.role || 'editor', 'role', SITE_ROLES);
    if (role === 'admin' && !hasRole(req.user.role, 'admin')) throw forbidden('Only an administrator can invite another administrator.');
    const email = req.body?.email ? emailValue(req.body.email) : null;
    const maxUses = numberValue(req.body?.maxUses ?? 1, 'maxUses', { integer: true, min: 1, max: 100 });
    let expiresAt = optionalNullableString(req.body?.expiresAt, 'expiresAt', 50) ?? null;
    if (!expiresAt && req.body?.expiresInDays !== undefined) {
      const days = numberValue(req.body.expiresInDays, 'expiresInDays', { integer: true, min: 1, max: 365 });
      expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    }
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw badRequest('expiresAt must be a valid future date.', { field: 'expiresAt' });
    }
    const code = createInviteCode();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO invitations
        (id, code_hash, code_last_four, email, site_id, role, max_uses, use_count,
         expires_at, revoked_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
    ).run(id, hashInviteCode(code), code.replace(/-/g, '').slice(-4), email, siteId, role, maxUses, expiresAt, req.user.id, now);
    const row = await db
      .prepare('SELECT i.*, s.name AS site_name FROM invitations i LEFT JOIN sites s ON s.id = i.site_id WHERE i.id = ?')
      .get(id);
    const invitation = serializeInvitation(row);
    if (siteId) emitSiteUpdate(siteId, 'invitation.created', req.user, { invitation });
    res.status(201).json({ data: { ...invitation, code }, invitation, code });
  };
  router.post('/invitations', createInvitation);
  router.post('/invites', createInvitation);

  const revokeInvitation = async (req, res) => {
    const id = idValue(req.params.invitationId, 'invitationId');
    const invitation = await db.prepare('SELECT * FROM invitations WHERE id = ?').get(id);
    if (!invitation) throw notFound('Invitation');
    if (invitation.site_id) await assertSiteAccess(db, req.user, invitation.site_id, 'manager');
    else requireWorkspaceAdmin(req.user);
    const now = new Date().toISOString();
    await db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ?').run(now, id);
    if (invitation.site_id) emitSiteUpdate(invitation.site_id, 'invitation.revoked', req.user, { invitationId: id });
    res.json({ data: { id, revokedAt: now }, success: true });
  };
  router.delete('/invitations/:invitationId', revokeInvitation);
  router.delete('/invites/:invitationId', revokeInvitation);

  router.patch('/members/:userId', async (req, res) => {
    const userId = idValue(req.params.userId, 'userId');
    const member = await db.prepare('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL').get(userId);
    if (!member) throw notFound('Member');
    const siteId = optionalNullableString(req.body?.siteId, 'siteId', 80) ?? null;
    const role = enumValue(req.body?.role, 'role', SITE_ROLES);
    const now = new Date().toISOString();
    if (siteId) {
      await getSite(db, siteId);
      await assertSiteAccess(db, req.user, siteId, 'manager');
      if (role === 'admin' && !hasRole(req.user.role, 'admin')) throw forbidden();
      await db.prepare(
        `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(site_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
      ).run(siteId, userId, role, req.user.id, now, now);
      emitSiteUpdate(siteId, 'member.updated', req.user, { userId, role });
    } else {
      requireWorkspaceAdmin(req.user);
      if (member.role === 'owner') throw forbidden('The workspace owner role cannot be changed.');
      await db.prepare('UPDATE users SET role = ?, workspace_access = 1, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(
        role,
        now,
        userId,
      );
    }
    disconnectUser(userId);
    res.json({ data: { userId, siteId, role }, success: true });
  });

  router.delete('/members/:userId', async (req, res) => {
    const userId = idValue(req.params.userId, 'userId');
    const member = await db.prepare('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL').get(userId);
    if (!member) throw notFound('Member');
    const siteId = optionalNullableString(req.query.siteId, 'siteId', 80) ?? null;
    if (siteId) {
      await assertSiteAccess(db, req.user, siteId, 'manager');
      await db.prepare('DELETE FROM site_members WHERE site_id = ? AND user_id = ?').run(siteId, userId);
      emitSiteUpdate(siteId, 'member.removed', req.user, { userId });
    } else {
      requireWorkspaceAdmin(req.user);
      if (member.role === 'owner') throw forbidden('The workspace owner cannot be removed.');
      const now = new Date().toISOString();
      await db.transaction(async () => {
        await db.prepare('DELETE FROM site_members WHERE user_id = ?').run(userId);
        await db.prepare(
          `UPDATE users SET disabled_at = ?, token_version = token_version + 1, updated_at = ?, workspace_access = 0
            WHERE id = ?`,
        ).run(now, now, userId);
      })();
    }
    disconnectUser(userId);
    res.json({ data: { removedId: userId, siteId }, success: true });
  });

  return router;
}

function requireWorkspaceAdmin(user) {
  if (!user.workspace_access || !hasRole(user.role, 'admin')) {
    throw forbidden('A workspace administrator is required.');
  }
}
