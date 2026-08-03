import React, { useEffect, useMemo, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { ConfirmDialog, EmptyState, Field, Menu, MenuButton, Modal, Spinner, formatWhen, initials, roleCanEdit, roleCanManage } from './Common.jsx';

const folderParent = (folder) => folder.parentId ?? folder.parent_id ?? null;
const surveyFolder = (survey) => survey.folderId ?? survey.folder_id ?? null;

function FolderNode({ folder, folders, selectedId, depth = 0, canManage, onSelect, onAction }) {
  const children = folders.filter((candidate) => folderParent(candidate) === folder.id);
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      <div className={`folder-row ${selectedId === folder.id ? 'selected' : ''}`} style={{ '--folder-depth': depth }}>
        {children.length ? (
          <button type="button" className="folder-row__toggle" onClick={() => setExpanded((value) => !value)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.name}`} aria-expanded={expanded}>
            <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
          </button>
        ) : <span className="folder-row__spacer" />}
        <button type="button" className="folder-row__name" onClick={() => onSelect(folder.id)}>
          <span aria-hidden="true">▰</span><span>{folder.name}</span>
        </button>
        {canManage && (
          <Menu label={`Actions for ${folder.name}`}>
            <MenuButton onClick={() => onAction('folder-create', { parentId: folder.id })}>New subfolder</MenuButton>
            <MenuButton onClick={() => onAction('folder-edit', { folder })}>Rename</MenuButton>
            <MenuButton onClick={() => onAction('folder-copy', { folder })}>Make a copy</MenuButton>
            <MenuButton onClick={() => onAction('folder-move', { folder })}>Move</MenuButton>
            <MenuButton danger onClick={() => onAction('folder-delete', { folder })}>Delete</MenuButton>
          </Menu>
        )}
      </div>
      {expanded && children.length > 0 && (
        <ul className="folder-tree">
          {children.map((child) => <FolderNode key={child.id} folder={child} folders={folders} selectedId={selectedId} depth={depth + 1} canManage={canManage} onSelect={onSelect} onAction={onAction} />)}
        </ul>
      )}
    </li>
  );
}

function SurveyCard({ survey, canEdit, onOpen, onAction }) {
  const hasPdf = Boolean(survey.hasPdf ?? survey.has_pdf ?? survey.pdfFileName ?? survey.pdf_file_name ?? survey.fileName ?? survey.file_name);
  const editor = survey.lastEditor?.name || survey.lastEditedBy?.name || survey.last_editor_name || survey.updatedBy?.name || 'No editor yet';
  const deviceCount = survey.elementCount ?? survey.element_count ?? survey.deviceCount ?? survey.device_count ?? 0;
  return (
    <article className="survey-card">
      <button type="button" className="survey-card__main" onClick={() => onOpen(survey)}>
        <span className={`survey-card__preview ${hasPdf ? '' : 'survey-card__preview--blank'}`} aria-hidden="true">
          <svg viewBox="0 0 210 126">
            <path d="M12 9h186v108H12z" />
            <path d="M26 26h72v38H26zM109 26h73v19h-73zM109 52h31v47h-31zM148 52h34v24h-34zM26 73h72v26H26z" />
            <circle cx="83" cy="45" r="6" /><circle cx="166" cy="64" r="6" />
          </svg>
          {!hasPdf && <small>Blank canvas</small>}
        </span>
        <span className="survey-card__body">
          <strong>{survey.name}</strong>
          {survey.description && <span className="survey-card__description">{survey.description}</span>}
          <span>{deviceCount} plotted element{deviceCount === 1 ? '' : 's'} · {survey.rotation ?? survey.orientation ?? 0}°</span>
          <span className="survey-card__edited"><span className="mini-avatar" aria-hidden="true">{initials(editor)}</span> {editor} · {formatWhen(survey.updatedAt || survey.updated_at)}</span>
        </span>
      </button>
      {canEdit && (
        <div className="survey-card__menu">
          <Menu label={`Actions for ${survey.name}`}>
            <MenuButton onClick={() => onAction('survey-edit', { survey })}>Edit details</MenuButton>
            <MenuButton onClick={() => onAction('survey-copy', { survey })}>Make a copy</MenuButton>
            <MenuButton onClick={() => onAction('survey-move', { survey })}>Move to folder</MenuButton>
            <MenuButton danger onClick={() => onAction('survey-delete', { survey })}>Delete</MenuButton>
          </Menu>
        </div>
      )}
    </article>
  );
}

function pathToFolder(folderId, folders) {
  const result = [];
  let current = folders.find((folder) => folder.id === folderId);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = folders.find((folder) => folder.id === folderParent(current));
  }
  return result;
}

export default function SiteWorkspace({ user, siteId, navigate, notify }) {
  const [site, setSite] = useState(null);
  const [folders, setFolders] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', files: [], items: [], destinationId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canEdit = roleCanEdit(user.role);
  const canManage = roleCanManage(user.role);

  const load = async () => {
    setLoading(true);
    try {
      const [allSites, folderResult, surveyResult] = await Promise.all([
        api.sites(), api.folders(siteId), api.surveys(siteId),
      ]);
      setSite(normalizeList(allSites).find((item) => item.id === siteId) || { id: siteId, name: 'Site' });
      setFolders(normalizeList(folderResult));
      setSurveys(normalizeList(surveyResult));
    } catch (loadError) { notify(loadError.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rootFolders = useMemo(() => folders.filter((folder) => !folderParent(folder)), [folders]);
  const selectedSurveys = useMemo(() => surveys.filter((survey) => String(surveyFolder(survey) || '') === String(selectedFolderId || '')), [selectedFolderId, surveys]);
  const breadcrumbs = useMemo(() => pathToFolder(selectedFolderId, folders), [selectedFolderId, folders]);

  const startAction = (type, data = {}) => {
    setError('');
    if (type === 'folder-create') setForm({ name: '', parentId: data.parentId ?? selectedFolderId, destinationId: '' });
    if (type === 'folder-edit') setForm({ name: data.folder.name, destinationId: '' });
    if (type === 'folder-move') setForm({ name: data.folder.name, destinationId: folderParent(data.folder) || '' });
    if (type === 'survey-create') setForm({ name: '', description: '', files: [], items: [], destinationId: selectedFolderId || '' });
    if (type === 'survey-edit') setForm({ name: data.survey.name, description: data.survey.description || '' });
    if (type === 'survey-move') setForm({ name: data.survey.name, destinationId: surveyFolder(data.survey) || '' });
    setModal({ type, ...data });
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (modal.type === 'folder-create') {
        const created = await api.createFolder({ siteId, parentId: form.parentId || null, name: form.name });
        setFolders((current) => [...current, created]);
        notify('Folder created.');
      }
      if (modal.type === 'folder-edit') {
        const updated = await api.updateFolder(modal.folder.id, { name: form.name });
        setFolders((current) => current.map((folder) => folder.id === modal.folder.id ? { ...folder, ...updated, name: form.name } : folder));
        notify('Folder renamed.');
      }
      if (modal.type === 'folder-move') {
        const updated = await api.moveFolder(modal.folder.id, { parentId: form.destinationId || null });
        setFolders((current) => current.map((folder) => folder.id === modal.folder.id ? { ...folder, ...updated, parentId: form.destinationId || null, parent_id: form.destinationId || null } : folder));
        notify('Folder moved.');
      }
      if (modal.type === 'survey-create') {
        const created = await api.createSurvey({
          siteId, folderId: selectedFolderId || '', name: form.name, description: form.description,
        });
        setSurveys((current) => [...current, created]);
        notify('Survey created.');
      }
      if (modal.type === 'survey-review') {
        const created = normalizeList(await api.createSurveysBatch({
          siteId,
          folderId: selectedFolderId || '',
          files: form.files,
          surveys: form.items.map(({ name, description }) => ({ name, description })),
        }));
        setSurveys((current) => [...current, ...created]);
        notify(`${created.length} survey${created.length === 1 ? '' : 's'} created.`);
      }
      if (modal.type === 'survey-edit') {
        const updated = await api.updateSurvey(modal.survey.id, { name: form.name, description: form.description });
        setSurveys((current) => current.map((survey) => survey.id === modal.survey.id ? { ...survey, ...updated, name: form.name, description: form.description } : survey));
        notify('Survey details updated.');
      }
      if (modal.type === 'survey-move') {
        const updated = await api.moveSurvey(modal.survey.id, { folderId: form.destinationId || null });
        setSurveys((current) => current.map((survey) => survey.id === modal.survey.id ? { ...survey, ...updated, folderId: form.destinationId || null, folder_id: form.destinationId || null } : survey));
        notify('Survey moved.');
      }
      setModal(null);
    } catch (saveError) { setError(saveError.message); }
    finally { setBusy(false); }
  };

  const copyFolder = async (folder) => {
    try {
      notify(`Copying ${folder.name}…`);
      await api.copyFolder(folder.id);
      await load();
      notify('Folder and its contents copied.');
    } catch (copyError) { notify(copyError.message); }
  };

  const copySurvey = async (survey) => {
    try {
      const copied = await api.copySurvey(survey.id);
      setSurveys((current) => [...current, copied]);
      notify('Survey copied.');
    } catch (copyError) { notify(copyError.message); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (modal.type === 'folder-delete') {
        await api.deleteFolder(modal.folder.id);
        if (selectedFolderId === modal.folder.id) setSelectedFolderId(null);
        await load();
        notify('Folder deleted.');
      } else {
        await api.deleteSurvey(modal.survey.id);
        setSurveys((current) => current.filter((survey) => survey.id !== modal.survey.id));
        notify('Survey deleted.');
      }
      setModal(null);
    } catch (removeError) { notify(removeError.message); }
    finally { setBusy(false); }
  };

  const folderAction = (type, data) => {
    if (type === 'folder-copy') copyFolder(data.folder);
    else startAction(type, data);
  };

  const surveyAction = (type, data) => {
    if (type === 'survey-copy') copySurvey(data.survey);
    else startAction(type, data);
  };

  if (loading) return <main id="main-content" className="page loading-panel"><Spinner label="Opening site…" /></main>;

  return (
    <main id="main-content" className="workspace-page">
      <div className="workspace-heading">
        <button type="button" className="back-button" onClick={() => navigate('sites')}><span aria-hidden="true">←</span> Sites</button>
        <div>
          <p className="eyebrow">Site workspace</p>
          <h1>{site?.name}</h1>
          {site?.address && <p>{site.address}</p>}
        </div>
        <button type="button" className="button button--secondary mobile-folder-button" onClick={() => setSidebarOpen(true)}>Folders</button>
      </div>

      <div className="workspace-layout">
        <aside className={`folder-sidebar ${sidebarOpen ? 'folder-sidebar--open' : ''}`} aria-label="Site folders">
          <div className="folder-sidebar__header">
            <h2>Folders</h2>
            {canManage && <button type="button" className="icon-button" onClick={() => startAction('folder-create', { parentId: selectedFolderId })} aria-label="Create folder">＋</button>}
            <button type="button" className="icon-button folder-sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close folder navigation">×</button>
          </div>
          <nav>
            <button type="button" className={`root-folder ${selectedFolderId == null ? 'selected' : ''}`} onClick={() => { setSelectedFolderId(null); setSidebarOpen(false); }}>
              <span aria-hidden="true">▦</span><span>Site root</span>
            </button>
            {rootFolders.length ? (
              <ul className="folder-tree">
                {rootFolders.map((folder) => <FolderNode key={folder.id} folder={folder} folders={folders} selectedId={selectedFolderId} canManage={canManage} onSelect={(id) => { setSelectedFolderId(id); setSidebarOpen(false); }} onAction={folderAction} />)}
              </ul>
            ) : <p className="folder-sidebar__empty">No folders yet</p>}
          </nav>
          <div className="folder-sidebar__footer">
            <span>{folders.length} folder{folders.length === 1 ? '' : 's'}</span>
            <span>{surveys.length} survey{surveys.length === 1 ? '' : 's'}</span>
          </div>
        </aside>

        <section className="survey-browser">
          <nav className="breadcrumbs" aria-label="Folder path">
            <button type="button" onClick={() => setSelectedFolderId(null)}>{site?.name}</button>
            {breadcrumbs.map((folder) => <React.Fragment key={folder.id}><span aria-hidden="true">/</span><button type="button" onClick={() => setSelectedFolderId(folder.id)}>{folder.name}</button></React.Fragment>)}
          </nav>
          <div className="survey-browser__heading">
            <div>
              <h2>{breadcrumbs.at(-1)?.name || 'Site root'}</h2>
              <p>{selectedSurveys.length} survey{selectedSurveys.length === 1 ? '' : 's'} in this folder</p>
            </div>
            {canEdit && (
              <div className="button-group">
                {canManage && <button type="button" className="button button--secondary" onClick={() => startAction('folder-create', { parentId: selectedFolderId })}>New folder</button>}
                <button type="button" className="button button--primary" onClick={() => startAction('survey-create')}><span aria-hidden="true">＋</span> New survey</button>
              </div>
            )}
          </div>

          {selectedSurveys.length ? (
            <div className="survey-grid">
              {selectedSurveys.map((survey) => <SurveyCard key={survey.id} survey={survey} canEdit={canEdit} onOpen={(item) => navigate(`surveys/${item.id}?site=${siteId}`)} onAction={surveyAction} />)}
            </div>
          ) : (
            <EmptyState title="No surveys in this folder" icon="⌑" action={canEdit ? <button type="button" className="button button--primary" onClick={() => startAction('survey-create')}>Create a survey</button> : undefined}>
              Upload a PDF floor plan or start with a blank survey canvas.
            </EmptyState>
          )}
        </section>
      </div>

      <Modal
        open={['folder-create', 'folder-edit', 'folder-move', 'survey-create', 'survey-review', 'survey-edit', 'survey-move'].includes(modal?.type)}
        title={{ 'folder-create': 'Create folder', 'folder-edit': 'Rename folder', 'folder-move': 'Move folder', 'survey-create': 'Create surveys', 'survey-review': 'Review selected floor plans', 'survey-edit': 'Edit survey details', 'survey-move': 'Move survey' }[modal?.type] || ''}
        description={modal?.type === 'survey-review' ? 'Each PDF will become an independent survey with its own plotted elements and markup.' : undefined}
        onClose={() => setModal(null)}
        wide={modal?.type === 'survey-review'}
      >
        <form className="stack-form" onSubmit={save}>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          {['folder-create', 'folder-edit'].includes(modal?.type) && (
            <Field label={modal?.type?.startsWith('folder') ? 'Folder name' : 'Survey name'}>
              <input required autoFocus value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          )}
          {modal?.type === 'survey-create' && (
            <>
              <Field label="PDF floor plans" hint="Select up to 20 PDFs. You will name and describe each survey on the next screen.">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={(event) => {
                    const files = [...(event.target.files || [])].slice(0, 20);
                    if (!files.length) return;
                    setForm({
                      ...form,
                      files,
                      items: files.map((file) => ({
                        name: file.name.replace(/\.pdf$/i, ''),
                        description: '',
                        filename: file.name,
                        size: file.size,
                      })),
                    });
                    setModal({ type: 'survey-review' });
                  }}
                />
              </Field>
              <div className="survey-create-divider"><span>or create a blank survey</span></div>
              <Field label="Blank survey name">
                <input required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Description (optional)">
                <textarea rows="3" maxLength="2000" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </>
          )}
          {modal?.type === 'survey-edit' && (
            <>
              <Field label="Survey name"><input required autoFocus value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Description (optional)"><textarea rows="4" maxLength="2000" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </>
          )}
          {modal?.type === 'survey-review' && (
            <div className="batch-survey-list">
              {form.items.map((item, index) => (
                <section className="batch-survey-row" key={`${item.filename}-${index}`}>
                  <div className="batch-survey-row__file">
                    <span aria-hidden="true">PDF</span>
                    <div><strong>{item.filename}</strong><small>{(item.size / 1024 / 1024).toFixed(1)} MB</small></div>
                  </div>
                  <div className="batch-survey-row__fields">
                    <Field label={`Survey name ${index + 1}`}>
                      <input required maxLength="180" value={item.name} onChange={(event) => setForm({
                        ...form,
                        items: form.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, name: event.target.value } : entry),
                      })} />
                    </Field>
                    <Field label="Description (optional)">
                      <textarea rows="2" maxLength="2000" value={item.description} onChange={(event) => setForm({
                        ...form,
                        items: form.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, description: event.target.value } : entry),
                      })} />
                    </Field>
                  </div>
                </section>
              ))}
            </div>
          )}
          {['folder-move', 'survey-move'].includes(modal?.type) && (
            <Field label="Destination folder">
              <select value={form.destinationId || ''} onChange={(e) => setForm({ ...form, destinationId: e.target.value })}>
                <option value="">Site root</option>
                {folders.filter((folder) => modal?.folder?.id !== folder.id && !pathToFolder(folder.id, folders).some((ancestor) => ancestor.id === modal?.folder?.id)).map((folder) => <option key={folder.id} value={folder.id}>{'— '.repeat(pathToFolder(folder.id, folders).length - 1)}{folder.name}</option>)}
              </select>
            </Field>
          )}
          <div className="modal__actions">
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button>
            <button className="button button--primary" disabled={busy}>{busy ? 'Saving…' : modal?.type === 'survey-review' ? `Create ${form.items.length} surveys` : modal?.type?.includes('move') ? 'Move' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={modal?.type === 'folder-delete' || modal?.type === 'survey-delete'} title={`Delete ${modal?.type === 'folder-delete' ? 'folder' : 'survey'}?`} busy={busy} onClose={() => setModal(null)} onConfirm={remove}>
        <p><strong>{modal?.folder?.name || modal?.survey?.name}</strong> {modal?.type === 'folder-delete' ? 'and all folders and surveys inside it' : 'and all of its elements, notes, and photos'} will be permanently deleted.</p>
      </ConfirmDialog>
    </main>
  );
}
