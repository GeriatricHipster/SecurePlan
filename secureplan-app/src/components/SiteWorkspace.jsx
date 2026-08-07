import React, { useEffect, useMemo, useState } from 'react';
import { api, normalizeList } from '../api.js';
import { ConfirmDialog, Field, Menu, MenuButton, Modal, Spinner, formatWhen, initials, roleCanEdit, roleCanManage } from './Common.jsx';
import { ALL_FOLDERS, folderParent, orderedFolders, surveyFolder, surveyFolderGroups } from './siteWorkspaceModel.js';
import { ArrowLeft, ChevronDown, ChevronRight, Folder, FolderOpen, LayoutGrid, Plus, X } from 'lucide-react';

function FolderNode({ folder, folders, selectedId, depth = 0, canManage, onSelect, onAction }) {
  const children = folders.filter((candidate) => String(folderParent(candidate) ?? '') === String(folder.id));
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      <div className={`folder-row ${selectedId === folder.id ? 'selected' : ''}`} style={{ '--folder-depth': depth }}>
        {children.length ? (
          <button type="button" className="folder-row__toggle" onClick={() => setExpanded((value) => !value)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${folder.name}`} aria-expanded={expanded}>
            {expanded ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
          </button>
        ) : <span className="folder-row__spacer" />}
        <button type="button" className="folder-row__name" onClick={() => onSelect(folder.id)}>
          <Folder aria-hidden="true" size={16} /><span>{folder.name}</span>
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

function SurveyFolderSection({ group, folders, canEdit, canManage, onCreateSurvey, onFolderAction, onOpenSurvey, onSurveyAction }) {
  const folderPath = group.folder ? pathToFolder(group.folder.id, folders).map((folder) => folder.name).join(' / ') : 'Plans stored at the site root';
  return (
    <section className="survey-folder-section" data-folder-id={group.id || 'root'}>
      <header className="survey-folder-section__header">
        <Folder className="survey-folder-section__icon" aria-hidden="true" size={18} />
        <div><h3>{group.folder?.name || 'Site root'}</h3><p>{folderPath}</p></div>
        <span className="count-badge">{group.surveys.length} survey{group.surveys.length === 1 ? '' : 's'}</span>
        <div className="survey-folder-section__actions">
          {canEdit && <button type="button" className="button button--secondary" onClick={() => onCreateSurvey(group.id)}><Plus aria-hidden="true" size={16} /> Survey</button>}
          {group.folder && canManage && <Menu label={`Actions for ${group.folder.name}`}><MenuButton onClick={() => onFolderAction('folder-create', { parentId: group.folder.id })}>New subfolder</MenuButton><MenuButton onClick={() => onFolderAction('folder-edit', { folder: group.folder })}>Rename</MenuButton><MenuButton onClick={() => onFolderAction('folder-copy', { folder: group.folder })}>Make a copy</MenuButton><MenuButton onClick={() => onFolderAction('folder-move', { folder: group.folder })}>Move</MenuButton><MenuButton danger onClick={() => onFolderAction('folder-delete', { folder: group.folder })}>Delete</MenuButton></Menu>}
        </div>
      </header>
      {group.surveys.length ? <div className="survey-grid">{group.surveys.map((survey) => <SurveyCard key={survey.id} survey={survey} canEdit={canEdit} onOpen={onOpenSurvey} onAction={onSurveyAction} />)}</div> : <div className="folder-inline-empty"><FolderOpen aria-hidden="true" size={28} /><p><strong>No surveys yet</strong><small>Upload a floor plan or create a blank survey in this folder.</small></p>{canEdit && <button type="button" onClick={() => onCreateSurvey(group.id)}>Create survey</button>}</div>}
    </section>
  );
}

function pathToFolder(folderId, folders) {
  const result = [];
  let current = folders.find((folder) => String(folder.id) === String(folderId));
  const visited = new Set();
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    result.unshift(current);
    current = folders.find((folder) => String(folder.id) === String(folderParent(current)));
  }
  return result;
}

export default function SiteWorkspace({ user, siteId, navigate, notify }) {
  const [site, setSite] = useState(null);
  const [folders, setFolders] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(ALL_FOLDERS);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', files: [], items: [], destinationId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileFoldersOpen, setMobileFoldersOpen] = useState(false);
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

  useEffect(() => { setSelectedFolderId(ALL_FOLDERS); load(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rootFolders = useMemo(() => folders.filter((folder) => !folderParent(folder)), [folders]);
  const folderOrder = useMemo(() => orderedFolders(folders), [folders]);
  const surveyGroups = useMemo(() => surveyFolderGroups(folders, surveys), [folders, surveys]);
  const visibleGroups = useMemo(() => selectedFolderId === ALL_FOLDERS ? surveyGroups : surveyGroups.filter((group) => String(group.id || '') === String(selectedFolderId || '')), [selectedFolderId, surveyGroups]);
  const breadcrumbs = useMemo(() => selectedFolderId === ALL_FOLDERS ? [] : pathToFolder(selectedFolderId, folders), [selectedFolderId, folders]);
  const activeFolderId = selectedFolderId === ALL_FOLDERS ? null : selectedFolderId;
  const visibleSurveyCount = visibleGroups.reduce((total, group) => total + group.surveys.length, 0);

  const startAction = (type, data = {}) => {
    setError('');
    if (type === 'folder-create') setForm({ name: '', parentId: data.parentId ?? activeFolderId, destinationId: '' });
    if (type === 'folder-edit') setForm({ name: data.folder.name, destinationId: '' });
    if (type === 'folder-move') setForm({ name: data.folder.name, destinationId: folderParent(data.folder) || '' });
    if (type === 'survey-create') setForm({ name: '', description: '', files: [], items: [], destinationId: data.folderId ?? activeFolderId ?? '' });
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
          siteId, folderId: form.destinationId || '', name: form.name, description: form.description,
        });
        setSurveys((current) => [...current, created]);
        notify('Survey created.');
      }
      if (modal.type === 'survey-review') {
        const created = normalizeList(await api.createSurveysBatch({
          siteId,
          folderId: form.destinationId || '',
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
        if (selectedFolderId === modal.folder.id || pathToFolder(selectedFolderId, folders).some((folder) => folder.id === modal.folder.id)) setSelectedFolderId(ALL_FOLDERS);
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

  const selectFolder = (id) => {
    setSelectedFolderId(id);
    setMobileFoldersOpen(false);
  };

  if (loading) return <main id="main-content" className="page loading-panel"><Spinner label="Opening site…" /></main>;

  return (
    <main id="main-content" className="workspace-page">
      <div className="workspace-heading">
        <button type="button" className="back-button" onClick={() => navigate('sites')}><ArrowLeft aria-hidden="true" size={16} /> Sites</button>
        <div>
          <p className="eyebrow">Site workspace</p>
          <h1>{site?.name}</h1>
          {site?.address && <p>{site.address}</p>}
        </div>
        {canEdit && <div className="workspace-heading__actions">{canManage && <button type="button" className="button button--secondary" onClick={() => startAction('folder-create', { parentId: activeFolderId })}>New folder</button>}<button type="button" className="button button--primary" onClick={() => startAction('survey-create', { folderId: activeFolderId })}><Plus aria-hidden="true" size={16} /> New survey</button></div>}
      </div>

      <div className="workspace-layout">
        {mobileFoldersOpen && <button type="button" className="mobile-folder-backdrop" aria-label="Close folder list" onClick={() => setMobileFoldersOpen(false)} />}
        <aside className={`folder-sidebar ${mobileFoldersOpen ? 'open' : ''}`} aria-label="Site folders">
          <div className="folder-sidebar__header">
            <h2>Quick filter</h2>
            <div className="folder-sidebar__header-actions">
              {canManage && <button type="button" className="icon-button" onClick={() => startAction('folder-create', { parentId: activeFolderId })} aria-label="Create folder"><Plus aria-hidden="true" size={18} /></button>}
              <button type="button" className="icon-button folder-sidebar__close" onClick={() => setMobileFoldersOpen(false)} aria-label="Close folders"><X aria-hidden="true" size={18} /></button>
            </div>
          </div>
          <nav>
            <button type="button" className={`root-folder ${selectedFolderId === ALL_FOLDERS ? 'selected' : ''}`} onClick={() => selectFolder(ALL_FOLDERS)}>
              <LayoutGrid aria-hidden="true" size={16} /><span>All folders</span>
            </button>
            <button type="button" className={`root-folder ${selectedFolderId == null ? 'selected' : ''}`} onClick={() => selectFolder(null)}>
              <LayoutGrid aria-hidden="true" size={16} /><span>Site root</span>
            </button>
            {rootFolders.length ? (
              <ul className="folder-tree">
                {rootFolders.map((folder) => <FolderNode key={folder.id} folder={folder} folders={folders} selectedId={selectedFolderId} canManage={canManage} onSelect={selectFolder} onAction={folderAction} />)}
              </ul>
            ) : <p className="folder-sidebar__empty">{canManage ? 'No folders yet — use ＋ above to add one.' : 'No folders yet.'}</p>}
          </nav>
          <div className="folder-sidebar__footer">
            <span>{folders.length} folder{folders.length === 1 ? '' : 's'}</span>
            <span>{surveys.length} survey{surveys.length === 1 ? '' : 's'}</span>
          </div>
        </aside>

        <section className="survey-browser">
          <nav className="breadcrumbs" aria-label="Folder path">
            <button type="button" onClick={() => selectFolder(ALL_FOLDERS)}>{site?.name}</button>
            {breadcrumbs.map((folder) => <React.Fragment key={folder.id}><span aria-hidden="true">/</span><button type="button" onClick={() => selectFolder(folder.id)}>{folder.name}</button></React.Fragment>)}
          </nav>
          <button type="button" className="mobile-folder-trigger" onClick={() => setMobileFoldersOpen(true)}><LayoutGrid aria-hidden="true" size={16} /> Browse folders</button>
          <div className="survey-browser__heading">
            <div>
              <h2>{selectedFolderId === ALL_FOLDERS ? 'All survey folders' : breadcrumbs.at(-1)?.name || 'Site root'}</h2>
              <p>{visibleGroups.length} folder section{visibleGroups.length === 1 ? '' : 's'} · {visibleSurveyCount} survey{visibleSurveyCount === 1 ? '' : 's'}</p>
            </div>
            {selectedFolderId !== ALL_FOLDERS && <button type="button" className="button button--ghost" onClick={() => selectFolder(ALL_FOLDERS)}>Show all folders</button>}
          </div>

          <div className="survey-folder-list">{visibleGroups.map((group) => <SurveyFolderSection key={group.id || 'root'} group={group} folders={folders} canEdit={canEdit} canManage={canManage} onCreateSurvey={(folderId) => startAction('survey-create', { folderId })} onFolderAction={folderAction} onOpenSurvey={(item) => navigate(`surveys/${item.id}?site=${siteId}`)} onSurveyAction={surveyAction} />)}</div>
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
              <Field label="Destination folder"><select value={form.destinationId || ''} onChange={(event) => setForm({ ...form, destinationId: event.target.value })}><option value="">Site root</option>{folderOrder.map((folder) => <option key={folder.id} value={folder.id}>{'— '.repeat(Math.max(0, pathToFolder(folder.id, folders).length - 1))}{folder.name}</option>)}</select></Field>
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
            <><Field label="Destination folder"><select value={form.destinationId || ''} onChange={(event) => setForm({ ...form, destinationId: event.target.value })}><option value="">Site root</option>{folderOrder.map((folder) => <option key={folder.id} value={folder.id}>{'— '.repeat(Math.max(0, pathToFolder(folder.id, folders).length - 1))}{folder.name}</option>)}</select></Field><div className="batch-survey-list">
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
            </div></>
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
