import React, { useEffect, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { ConfirmDialog, EmptyState, Field, Menu, MenuButton, Modal, Spinner, formatWhen, initials } from './Common.jsx';

const roles = [
  { value: 'viewer', label: 'Viewer', help: 'View plans, notes, and schedules.' },
  { value: 'installer', label: 'Installer', help: 'Update field items, notes, and photos.' },
  { value: 'editor', label: 'Editor', help: 'Create and edit survey markup.' },
  { value: 'manager', label: 'Manager', help: 'Manage sites, folders, and surveys.' },
  { value: 'admin', label: 'Administrator', help: 'Manage the workspace and team.' },
];

function roleLabel(value) {
  return roles.find((role) => role.value === value)?.label || value;
}

export default function TeamPage({ user, notify }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ role: 'editor', email: '', expiresInDays: '7', maxUses: '1' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = ['owner', 'admin'].includes(user.role);

  const load = async () => {
    setLoading(true);
    try {
      const [memberResult, invitationResult] = await Promise.all([
        canManage ? api.members() : Promise.resolve([user]), canManage ? api.invitations() : Promise.resolve([]),
      ]);
      setMembers(normalizeList(memberResult));
      setInvitations(normalizeList(invitationResult).filter((invitation) => {
        const expired = invitation.expiresAt && Date.parse(invitation.expiresAt) <= Date.now();
        const exhausted = Number(invitation.useCount ?? invitation.use_count ?? 0) >= Number(invitation.maxUses ?? invitation.max_uses ?? 1);
        return !invitation.revokedAt && !invitation.revoked_at && !expired && !exhausted;
      }));
    } catch (loadError) { notify(loadError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createInvite = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.createInvitation({
        role: form.role,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        expiresInDays: Number(form.expiresInDays),
        maxUses: Number(form.maxUses),
      });
      setInvitations((current) => [created, ...current]);
      setModal({ type: 'invite-created', invitation: created });
    } catch (inviteError) { setError(inviteError.message); }
    finally { setBusy(false); }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Invitation code copied.');
    } catch {
      notify(`Invitation code: ${code}`);
    }
  };

  const updateRole = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await api.updateMember(modal.member.id, { role: form.role });
      setMembers((current) => current.map((member) => member.id === modal.member.id ? { ...member, ...updated, role: form.role } : member));
      setModal(null);
      notify('Member role updated.');
    } catch (updateError) { setError(updateError.message); }
    finally { setBusy(false); }
  };

  const removeMember = async () => {
    setBusy(true);
    try {
      await api.removeMember(modal.member.id);
      setMembers((current) => current.filter((member) => member.id !== modal.member.id));
      setModal(null);
      notify('Member removed.');
    } catch (removeError) { notify(removeError.message); }
    finally { setBusy(false); }
  };

  const revokeInvite = async (invitation) => {
    try {
      await api.revokeInvitation(invitation.id);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      notify('Invitation revoked.');
    } catch (revokeError) { notify(revokeError.message); }
  };

  const openInvite = () => {
    setForm({ role: 'editor', email: '', expiresInDays: '7', maxUses: '1' });
    setError('');
    setModal({ type: 'invite' });
  };

  if (loading) return <main id="main-content" className="page loading-panel"><Spinner label="Loading team…" /></main>;

  return (
    <main id="main-content" className="page page--team">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Collaboration</p>
          <h1>Team & invitations</h1>
          <p>Control who can enter the workspace and what they are allowed to change.</p>
        </div>
        {canManage && <button type="button" className="button button--primary" onClick={openInvite}><span aria-hidden="true">＋</span> Create invite</button>}
      </div>

      <section className="panel team-panel">
        <div className="panel__heading">
          <div><h2>Members</h2><p>{members.length} person{members.length === 1 ? '' : 's'} in this workspace</p></div>
        </div>
        {members.length ? (
          <div className="member-list">
            {members.map((member) => (
              <article className="member-row" key={member.id}>
                <span className="avatar avatar--large" aria-hidden="true">{initials(member.name)}</span>
                <div className="member-row__identity"><strong>{member.name}{member.id === user.id && <small> You</small>}</strong><span>{member.email}</span></div>
                <span className="member-row__activity">Active {formatWhen(member.lastSeenAt || member.last_seen_at || member.updatedAt || member.updated_at)}</span>
                <span className="role-badge">{roleLabel(member.role)}</span>
                {canManage && member.role !== 'owner' && member.id !== user.id && (
                  <Menu label={`Actions for ${member.name}`}>
                    <MenuButton onClick={() => { setForm({ role: member.role }); setError(''); setModal({ type: 'role', member }); }}>Change role</MenuButton>
                    <MenuButton danger onClick={() => setModal({ type: 'remove', member })}>Remove member</MenuButton>
                  </Menu>
                )}
              </article>
            ))}
          </div>
        ) : <EmptyState title="No team members" icon="♟">Create an invitation to add your first collaborator.</EmptyState>}
      </section>

      {canManage && (
        <section className="panel team-panel">
          <div className="panel__heading"><div><h2>Active invitation codes</h2><p>Codes can be revoked at any time.</p></div></div>
          {invitations.length ? (
            <div className="invite-list">
              {invitations.map((invitation) => (
                <article className="invite-row" key={invitation.id}>
                  <div><strong className="invite-code">{invitation.code || invitation.displayCode || invitation.display_code || 'Code hidden after creation'}</strong><span>{roleLabel(invitation.role)} · {invitation.useCount ?? invitation.uses ?? invitation.use_count ?? 0}/{invitation.maxUses ?? invitation.max_uses ?? 1} uses{invitation.email ? ` · ${invitation.email}` : ''}</span></div>
                  <span>Expires {formatWhen(invitation.expiresAt || invitation.expires_at)}</span>
                  {(invitation.code || invitation.displayCode || invitation.display_code) && <button type="button" className="button button--secondary" onClick={() => copyCode(invitation.code || invitation.displayCode || invitation.display_code)}>Copy</button>}
                  <button type="button" className="button button--ghost danger-text" onClick={() => revokeInvite(invitation)}>Revoke</button>
                </article>
              ))}
            </div>
          ) : <div className="inline-empty"><p>No active invitation codes.</p><button type="button" className="button button--secondary" onClick={openInvite}>Create one</button></div>}
        </section>
      )}

      <Modal open={modal?.type === 'invite'} title="Create invitation code" description="The person using this code will receive the selected workspace role." onClose={() => setModal(null)}>
        <form className="stack-form" onSubmit={createInvite}>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          <Field label="Permission level">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.filter((role) => user.role === 'owner' || role.value !== 'admin').map((role) => <option key={role.value} value={role.value}>{role.label} — {role.help}</option>)}
            </select>
          </Field>
          <Field label="Limit to email (optional)" hint="Required when restoring a previously removed teammate.">
            <input type="email" autoComplete="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="teammate@example.com" />
          </Field>
          <div className="form-grid form-grid--two">
            <Field label="Expires after"><select value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}><option value="1">1 day</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></Field>
            <Field label="Maximum uses"><select value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })}><option value="1">1 person</option><option value="5">5 people</option><option value="10">10 people</option><option value="25">25 people</option></select></Field>
          </div>
          <div className="modal__actions"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button></div>
        </form>
      </Modal>

      <Modal open={modal?.type === 'invite-created'} title="Invitation ready" description="Send this code securely to the person you want to invite." onClose={() => setModal(null)}>
        <div className="created-code"><span>{modal?.invitation?.code || modal?.invitation?.displayCode || modal?.invitation?.display_code}</span><button type="button" className="button button--primary" onClick={() => copyCode(modal?.invitation?.code || modal?.invitation?.displayCode || modal?.invitation?.display_code)}>Copy code</button></div>
        <p className="muted">Role: {roleLabel(modal?.invitation?.role)}{modal?.invitation?.email ? ` · Restricted to ${modal.invitation.email}` : ''}. The recipient can select “Use invite code” on the sign-in screen.</p>
      </Modal>

      <Modal open={modal?.type === 'role'} title={`Change ${modal?.member?.name || 'member'}’s role`} onClose={() => setModal(null)}>
        <form className="stack-form" onSubmit={updateRole}>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          <Field label="Permission level"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label} — {role.help}</option>)}</select></Field>
          <div className="modal__actions"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button className="button button--primary" disabled={busy}>Save role</button></div>
        </form>
      </Modal>

      <ConfirmDialog open={modal?.type === 'remove'} title="Remove team member?" busy={busy} onClose={() => setModal(null)} onConfirm={removeMember} confirmLabel="Remove member">
        <p><strong>{modal?.member?.name}</strong> will immediately lose access to the workspace. Their survey history will be retained. To restore them later, create a new invitation restricted to their email address.</p>
      </ConfirmDialog>
    </main>
  );
}
