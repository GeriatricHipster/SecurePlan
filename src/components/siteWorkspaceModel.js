export const ALL_FOLDERS = '__all_folders__';

export const folderParent = (folder) => folder?.parentId ?? folder?.parent_id ?? null;
export const surveyFolder = (survey) => survey?.folderId ?? survey?.folder_id ?? null;

export function orderedFolders(folders = []) {
  const result = [];
  const visited = new Set();
  const byParent = new Map();
  for (const folder of folders) {
    const parentId = folderParent(folder);
    const matchingParent = parentId && folders.find((candidate) => String(candidate.id) === String(parentId));
    const key = matchingParent?.id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(folder);
  }
  const visit = (folder) => {
    if (!folder || visited.has(folder.id)) return;
    visited.add(folder.id);
    result.push(folder);
    for (const child of byParent.get(folder.id) || []) visit(child);
  };
  for (const root of byParent.get(null) || []) visit(root);
  for (const folder of folders) visit(folder);
  return result;
}

export function surveyFolderGroups(folders = [], surveys = []) {
  const folderIds = new Set(folders.map((folder) => String(folder.id)));
  const groups = [{
    id: null,
    folder: null,
    surveys: surveys.filter((survey) => {
      const folderId = surveyFolder(survey);
      return folderId == null || folderId === '' || !folderIds.has(String(folderId));
    }),
  }];
  for (const folder of orderedFolders(folders)) {
    groups.push({ id: folder.id, folder, surveys: surveys.filter((survey) => String(surveyFolder(survey) || '') === String(folder.id)) });
  }
  return groups;
}
