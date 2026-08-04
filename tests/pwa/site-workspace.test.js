import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ALL_FOLDERS,
  folderParent,
  orderedFolders,
  surveyFolder,
  surveyFolderGroups,
} from '../../src/components/siteWorkspaceModel.js';

const workspaceSourceUrl = new URL('../../src/components/SiteWorkspace.jsx', import.meta.url);
const editorSourceUrl = new URL('../../src/components/SurveyEditor.jsx', import.meta.url);
const stylesSourceUrl = new URL('../../src/styles.css', import.meta.url);

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
}

test('site workspace model groups root, empty, nested, orphan, and cyclic folders without losing surveys', () => {
  const folders = [
    { id: 'campus', name: 'Campus', parentId: null },
    { id: 'floor-1', name: 'Floor 1', parent_id: 'campus' },
    { id: 'empty', name: 'Empty folder', parentId: null },
    { id: 'orphan', name: 'Recovered orphan', parent_id: 'missing-parent' },
    { id: 'cycle-a', name: 'Cycle A', parentId: 'cycle-b' },
    { id: 'cycle-b', name: 'Cycle B', parent_id: 'cycle-a' },
  ];
  const surveys = [
    { id: 'root-camel', folderId: null },
    { id: 'root-snake', folder_id: null },
    { id: 'nested-camel', folderId: 'floor-1' },
    { id: 'nested-snake', folder_id: 'floor-1' },
    { id: 'orphan-survey', folder_id: 'orphan' },
    { id: 'cycle-survey', folderId: 'cycle-a' },
  ];

  assert.equal(ALL_FOLDERS, '__all_folders__');
  assert.equal(folderParent(folders[1]), 'campus');
  assert.equal(folderParent(folders[3]), 'missing-parent');
  assert.equal(surveyFolder(surveys[2]), 'floor-1');
  assert.equal(surveyFolder(surveys[3]), 'floor-1');

  const ordered = orderedFolders(folders);
  assert.deepEqual(
    ordered.map((folder) => folder.id),
    ['campus', 'floor-1', 'empty', 'orphan', 'cycle-a', 'cycle-b'],
  );
  assert.equal(new Set(ordered.map((folder) => folder.id)).size, folders.length);

  const groups = surveyFolderGroups(folders, surveys);
  const byId = new Map(groups.map((group) => [group.id, group]));
  assert.deepEqual(groups.map((group) => group.id), [null, ...ordered.map((folder) => folder.id)]);
  assert.deepEqual(byId.get(null).surveys.map((survey) => survey.id), ['root-camel', 'root-snake']);
  assert.deepEqual(byId.get('floor-1').surveys.map((survey) => survey.id), ['nested-camel', 'nested-snake']);
  assert.deepEqual(byId.get('empty').surveys, [], 'empty folders must remain visible');
  assert.deepEqual(byId.get('orphan').surveys.map((survey) => survey.id), ['orphan-survey']);
  assert.deepEqual(byId.get('cycle-a').surveys.map((survey) => survey.id), ['cycle-survey']);

  const assignedIds = groups.flatMap((group) => group.surveys.map((survey) => survey.id));
  assert.deepEqual(assignedIds.toSorted(), surveys.map((survey) => survey.id).toSorted());
  assert.equal(new Set(assignedIds).size, surveys.length, 'each survey must appear in exactly one folder section');
});

test('site workspace defaults and resets to the all-folder view and renders every folder section', async () => {
  const source = await readFile(workspaceSourceUrl, 'utf8');

  assert.match(source, /const \[selectedFolderId, setSelectedFolderId\] = useState\(ALL_FOLDERS\)/);
  assert.match(source, /useEffect\(\(\) => \{ setSelectedFolderId\(ALL_FOLDERS\); load\(\); \}, \[siteId\]\)/);
  assert.match(source, /selectedFolderId === ALL_FOLDERS \? surveyGroups : surveyGroups\.filter/);
  assert.match(source, /<div className="survey-folder-list">\{visibleGroups\.map\(\(group\) => <SurveyFolderSection/);
  assert.match(source, /className="folder-filter-bar" aria-label="Filter surveys by folder"/);
  assert.match(source, /aria-pressed=\{selectedFolderId === ALL_FOLDERS\}/);
  assert.match(source, /group\.surveys\.length \? <div className="survey-grid">/);
  assert.match(source, /className="folder-inline-empty"/);
});

test('new blank and batch surveys use the chosen destination instead of the current filter', async () => {
  const source = await readFile(workspaceSourceUrl, 'utf8');
  const destinationWrites = source.match(/folderId: form\.destinationId \|\| ''/g) || [];

  assert.equal(destinationWrites.length, 2, 'blank and batch survey creation must both use destinationId');
  assert.match(source, /destinationId: data\.folderId \?\? activeFolderId \?\? ''/);
  assert.match(source, /onCreateSurvey=\{\(folderId\) => startAction\('survey-create', \{ folderId \}\)\}/);
  assert.ok((source.match(/<Field label="Destination folder">/g) || []).length >= 3, 'create, batch review, and move forms must expose a destination');
  assert.doesNotMatch(source, /folderId: selectedFolderId \|\| ''/);
});

test('mobile site workspace is compact and folder surveys do not depend on an off-canvas menu', async () => {
  const styles = await readFile(stylesSourceUrl, 'utf8');
  const tabletStart = styles.indexOf('@media (max-width: 900px)');
  const phoneStart = styles.indexOf('@media (max-width: 640px)', tabletStart);
  const nextMedia = styles.indexOf('@media (max-height:', phoneStart);
  assert.notEqual(tabletStart, -1);
  assert.notEqual(phoneStart, -1);
  const tablet = styles.slice(tabletStart, phoneStart);
  const phone = styles.slice(phoneStart, nextMedia === -1 ? undefined : nextMedia);

  assert.match(cssRule(tablet, '.folder-sidebar'), /display:\s*none;/);
  const mobileWorkspace = cssRule(tablet, '.workspace-layout');
  assert.match(mobileWorkspace, /border:\s*0;/);
  assert.match(mobileWorkspace, /box-shadow:\s*none;/);

  const folderFilters = cssRule(phone, '.folder-filter-bar');
  assert.match(folderFilters, /position:\s*sticky;/);
  assert.match(folderFilters, /overflow|background/);
  assert.match(cssRule(phone, '.folder-filter-bar button'), /min-height:\s*44px;/);

  const compactCard = cssRule(phone, '.survey-card__main');
  assert.match(compactCard, /display:\s*grid;/);
  assert.match(compactCard, /grid-template-columns:\s*104px minmax\(0, 1fr\);/);
  assert.match(cssRule(phone, '.survey-card__preview'), /width:\s*104px;/);
  assert.match(cssRule(phone, '.workspace-heading__actions'), /grid-template-columns:\s*1fr 1fr;/);
});

test('mobile editor panels behave as bottom sheets and selecting an item does not open Details', async () => {
  const [source, styles] = await Promise.all([
    readFile(editorSourceUrl, 'utf8'),
    readFile(stylesSourceUrl, 'utf8'),
  ]);
  const tabletStart = styles.indexOf('@media (max-width: 900px)');
  const phoneStart = styles.indexOf('@media (max-width: 640px)', tabletStart);
  const tablet = styles.slice(tabletStart, phoneStart);

  assert.match(source, /mobile-editor-drawer mobile-editor-drawer--left/);
  assert.match(source, /mobile-editor-drawer mobile-editor-drawer--right/);
  assert.match(source, /className="mobile-editor-backdrop"/);

  const sheet = cssRule(tablet, '.mobile-editor-drawer');
  assert.match(sheet, /position:\s*fixed;/);
  assert.match(sheet, /bottom:\s*var\(--editor-mobile-nav-height\);/);
  assert.match(sheet, /width:\s*100%;/);
  assert.match(sheet, /border-radius:\s*20px 20px 0 0;/);
  assert.match(sheet, /transform:\s*translateY\(105%\);/);
  assert.match(cssRule(tablet, '.mobile-editor-drawer.open'), /transform:\s*translateY\(0\);/);
  assert.match(cssRule(tablet, '.mobile-editor-drawer::before'), /width:\s*42px;/);
  assert.match(cssRule(tablet, '.mobile-editor-backdrop'), /position:\s*fixed;/);

  assert.match(source, /onSelect=\{setSelectedId\}/);
  assert.doesNotMatch(source, /setMobilePanel\(\s*['"]inspector['"]\s*\)/, 'canvas selection must not automatically cover the plan with Details');
  assert.match(source, /onClick=\{\(\) => setMobilePanel\(mobilePanel === 'inspector' \? null : 'inspector'\)\}/, 'Details must open only from its explicit mobile navigation button');
});
