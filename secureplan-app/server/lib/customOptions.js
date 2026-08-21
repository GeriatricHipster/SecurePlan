import crypto from 'node:crypto';

export async function mergedFieldOptions(db, fieldType, baseOptions) {
  try {
    const customRows = await db.prepare('SELECT value FROM task_custom_options WHERE field_type = ? ORDER BY value COLLATE NOCASE').all(fieldType);
    const custom = customRows.map((row) => row.value);
    const seen = new Set(baseOptions.map((value) => value.toLowerCase()));
    const extra = custom.filter((value) => !seen.has(value.toLowerCase()));
    return [...baseOptions, ...extra, 'Other'];
  } catch (error) {
    console.error('Failed to load custom field options (falling back to base list):', error.message);
    return [...baseOptions, 'Other'];
  }
}

export async function rememberCustomFieldValue(db, fieldType, baseOptions, value) {
  if (!value) return;
  if (baseOptions.some((option) => option.toLowerCase() === value.toLowerCase())) return;
  try {
    await db.prepare('INSERT INTO task_custom_options (id, field_type, value, created_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), fieldType, value, new Date().toISOString());
  } catch {
    // Unique constraint means someone else already added this exact value concurrently - fine, it's there either way.
  }
}
