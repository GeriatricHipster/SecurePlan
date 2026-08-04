import React, { useEffect, useMemo, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { ConfirmDialog, EmptyState, Field, Menu, MenuButton, Modal, Spinner, formatWhen, initials, roleCanManage } from './Common.jsx';

function SiteCard({ site, index, total, canManage, canDelete, onOpen, onEdit, onCopy, onDelete, onMove }) {
  const count = site.surveyCount ?? site.survey_count ?? site.surveys?.length ?? 0;
  const editor = site.lastEditedBy?.name || site.last_editor_name || site.updatedBy?.name || 'No editor yet';
  const updated = site.updatedAt || site.updated_at;
  return (
    <article className="site-card">
      <button type="button" className="site-card__main" onClick={() => onOpen(site)} aria-label={`Open ${site.name}`}>
        <span className="site-card__visual" aria-hidden="true">
          <svg viewBox="0 0 240 130">
            <path d="M15 28h76l13 16h121v74H15z" />
            <g>
              <path d="M35 64h68v38H35zM112 56h89v46h-89z" />
              <path d="M46 73h46M46 83h33M123 68h60M123 80h43M123 91h53" />
            </g>
          </svg>
        </span>
        <span className="site-card__body">
          <span className="site-card__title-row">
            <strong>{site.name}</strong>
            <span className="count-badge">{count} survey{count === 1 ? '' : 's'}</span>
          </span>
          <span className="site-card__address">{site.address || site.description || 'No location added'}</span>
          <span className="site-card__meta">
            <span className="mini-avatar" aria-hidden="true">{initials(editor)}</span>
            Last edited by {editor} · {formatWhen(updated)}
          </span>
        </span>
      </button>
      {canManage && (
        <div className="site-card__menu">
          <Menu label={`Actions for ${site.name}`}>
            <MenuButton onClick={() => onEdit(site)}>Rename & details</MenuButton>
            <MenuButton onClick={() => onCopy(site)}>Make a copy</MenuButton>
            <MenuButton disabled={index === 0} onClick={() => onMove(index, -1)}>Move earlier</MenuButton>
            <MenuButton disabled={index === total - 1} onClick={() => onMove(index, 1)}>Move later</MenuButton>
            {canDelete && <MenuButton danger onClick={() => onDelete(site)}>Delete site</MenuButton>}
          </Menu>
        </div>
      )}
    </article>
  );
}

export default function SitesDashboard({ user, navigate, notify }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const canManage = roleCanManage(user.role);
  const canDelete = ['owner', 'admin'].includes(user.role);

  const load = async () => {
    setLoading(true);
    try { setSites(normalizeList(await api.sites())); }
    catch (loadError) { notify(loadError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sites;
    return sites.filter((site) => `${site.name} ${site.address || ''} ${site.description || ''}`.toLowerCase().includes(query));
  }, [search, sites]);

  const openCreate = () => {
    setForm({ name: '', address: '', description: '' });
    setError('');
    setModal({ type: 'create' });
  };

  const openEdit = (site) => {
    setForm({ name: site.name, address: site.address || '', description: site.description || '' });
    setError('');
    setModal({ type: 'edit', site });
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (modal.type === 'create') {
        const created = await api.createSite(form);
        setSites((current) => [...current, created]);
        notify(`${form.name} created.`);
      } else {
        const updated = await api.updateSite(modal.site.id, form);
        setSites((current) => current.map((site) => site.id === modal.site.id ? { ...site, ...updated, ...form } : site));
        notify('Site updated.');
      }
      setModal(null);
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };

  const copy = async (site) => {
    try {
      notify(`Copying ${site.name}…`);
      const copied = await api.copySite(site.id);
      setSites((current) => [...current, {
        ...copied,
        surveyCount: site.surveyCount ?? site.survey_count ?? 0,
        folderCount: site.folderCount ?? site.folder_count ?? 0,
      }]);
      notify(`${site.name} copied.`);
    } catch (copyError) { notify(copyError.message); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteSite(modal.site.id, deleteConfirmation);
      setSites((current) => current.filter((site) => site.id !== modal.site.id));
      notify(`${modal.site.name} deleted.`);
      setModal(null);
    } catch (removeError) { notify(removeError.message); }
    finally { setBusy(false); }
  };

  const move = async (index, direction) => {
    const next = [...sites];
    const target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    setSites(next);
    try { await api.reorderSites(next.map((site) => site.id)); }
    catch (moveError) {
      setSites(sites);
      notify(moveError.message);
    }
  };

  return (
    <main id="main-content" className="page page--sites">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Sites</h1>
          <p>Organize buildings, plans, surveys, and field documentation.</p>
        </div>
        {canManage && <button type="button" className="button button--primary" onClick={openCreate}><span aria-hidden="true">＋</span> New site</button>}
      </div>

      <div className="toolbar-row">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search sites</span>
          <input type="search" placeholder="Search sites or addresses" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <span className="result-count" aria-live="polite">{filtered.length} site{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? <div className="loading-panel"><Spinner label="Loading sites…" /></div> : filtered.length ? (
        <div className="site-grid">
          {filtered.map((site) => {
            const actualIndex = sites.findIndex((candidate) => candidate.id === site.id);
            return <SiteCard key={site.id} site={site} index={actualIndex} total={sites.length} canManage={canManage} canDelete={canDelete} onOpen={(item) => navigate(`sites/${item.id}`)} onEdit={openEdit} onCopy={copy} onDelete={(item) => { setDeleteConfirmation(''); setModal({ type: 'delete', site: item }); }} onMove={move} />;
          })}
        </div>
      ) : (
        <EmptyState title={search ? 'No sites match your search' : 'Create your first site'} icon="▦" action={!search && canManage ? <button type="button" className="button button--primary" onClick={openCreate}>Create a site</button> : undefined}>
          {search ? 'Try another site name or address.' : 'A site holds folders, floor plans, surveys, and your team’s markup.'}
        </EmptyState>
      )}

      <Modal open={modal?.type === 'create' || modal?.type === 'edit'} title={modal?.type === 'create' ? 'Create a site' : 'Edit site'} onClose={() => setModal(null)}>
        <form className="stack-form" onSubmit={save}>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          <Field label="Site name"><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Address or location"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Description"><textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="modal__actions">
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="button button--primary" disabled={busy}>{busy ? 'Saving…' : modal?.type === 'create' ? 'Create site' : 'Save changes'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={modal?.type === 'delete'} title="Delete this site?" onClose={() => setModal(null)}>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); remove(); }}>
          <p><strong>{modal?.site?.name}</strong> and every folder, survey, element, note, and photo inside it will be permanently deleted.</p>
          <Field label={`Type “${modal?.site?.name || ''}” to confirm`}><input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></Field>
          <div className="modal__actions"><button type="button" className="button button--ghost" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="button button--danger" disabled={busy || deleteConfirmation !== modal?.site?.name}>{busy ? 'Deleting…' : 'Delete site'}</button></div>
        </form>
      </Modal>
    </main>
  );
}
