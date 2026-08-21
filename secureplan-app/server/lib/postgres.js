import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from 'pg';

const transactionStore = new AsyncLocalStorage();

export function createPostgresDatabase(config, poolOverride) {
  const pool = poolOverride || new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  return new PostgresDatabase(pool);
}

class PostgresDatabase {
  constructor(pool) {
    this.pool = pool;
    this.ready = this.initialize();
  }

  async initialize() {
    await this.pool.query(POSTGRES_SCHEMA);
    const now = new Date().toISOString();
    for (const profile of BUILTIN_PROFILES) {
      await this.pool.query(
        `INSERT INTO icon_profiles
          (id, site_id, name, category, description, color, components_json, icon_data,
           is_shared, is_builtin, created_by, updated_by, created_at, updated_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, NULL, 1, 1, NULL, NULL, $7, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, category = EXCLUDED.category,
           description = EXCLUDED.description, color = EXCLUDED.color,
           components_json = EXCLUDED.components_json, is_shared = 1,
           is_builtin = 1, updated_at = EXCLUDED.updated_at`,
        [profile.id, profile.name, profile.category, profile.description, profile.color, JSON.stringify(profile.components), now],
      );
    }
  }

  prepare(sql) {
    return {
      get: async (...args) => (await this.query(sql, args)).rows[0],
      all: async (...args) => (await this.query(sql, args)).rows,
      run: async (...args) => {
        const result = await this.query(sql, args);
        return { changes: result.rowCount, rowCount: result.rowCount };
      },
    };
  }

  transaction(operation) {
    return async (...args) => {
      await this.ready;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionStore.run(client, () => operation(...args));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
  }

  async query(sql, args) {
    await this.ready;
    const normalized = normalizeQuery(sql, args);
    const client = transactionStore.getStore() || this.pool;
    return client.query(normalized.text, normalized.values);
  }

  async close() {
    await this.ready.catch(() => {});
    await this.pool.end();
  }
}

function normalizeQuery(sql, args) {
  let text = String(sql)
    .replace(/\s+COLLATE\s+NOCASE/gi, '')
    .replace(/\b([a-zA-Z_][a-zA-Z0-9_.]*)\s+IS\s+\?/gi, '$1 IS NOT DISTINCT FROM ?');
  let values;

  if (args.length === 1 && isPlainObject(args[0]) && /@[a-zA-Z_]/.test(text)) {
    const source = args[0];
    values = [];
    const positions = new Map();
    text = text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
      if (!Object.hasOwn(source, name)) throw new Error(`Missing SQL parameter: ${name}`);
      if (!positions.has(name)) {
        values.push(source[name]);
        positions.set(name, values.length);
      }
      return `$${positions.get(name)}`;
    });
  } else {
    values = args;
    let index = 0;
    text = text.replace(/\?/g, () => `$${++index}`);
  }

  return { text, values };
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

const BUILTIN_PROFILES = [
  {
    id: 'builtin-full-door', name: 'Full Door', category: 'Doors',
    description: 'Card reader, door position switch, request-to-exit, and door lock.', color: '#DC2626',
    components: [
      { category: 'access_control', type: 'card_reader', label: 'Card Reader', symbol: 'CR', offsetX: -0.032, offsetY: 0 },
      { category: 'access_control', type: 'door_position', label: 'Door Position Switch', symbol: 'DPS', offsetX: 0, offsetY: -0.038 },
      { category: 'access_control', type: 'request_to_exit', label: 'Request to Exit', symbol: 'REX', offsetX: 0.032, offsetY: 0 },
      { category: 'access_control', type: 'door_lock', label: 'Door Lock', symbol: 'DL', offsetX: 0, offsetY: 0.038 },
    ],
  },
  {
    id: 'builtin-card-reader-door', name: 'Reader Door', category: 'Access Control',
    description: 'Card reader and electrified lock.', color: '#E11D48',
    components: [
      { category: 'access_control', type: 'card_reader', label: 'Card Reader', symbol: 'CR', offsetX: -0.024, offsetY: 0 },
      { category: 'access_control', type: 'door_lock', label: 'Door Lock', symbol: 'DL', offsetX: 0.024, offsetY: 0 },
    ],
  },
  {
    id: 'builtin-camera-station', name: 'Camera Station', category: 'CCTV',
    description: 'Camera placement with a field-of-view marker.', color: '#2563EB',
    components: [
      { category: 'cctv', type: 'fixed_camera', label: 'Fixed Camera', symbol: 'CAM', offsetX: 0, offsetY: 0 },
    ],
  },
];

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer','installer','editor','manager','admin','owner')),
    workspace_access INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0,
    disabled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_members (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer','installer','editor','manager','admin')),
    added_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (site_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    original_filename TEXT,
    storage_key TEXT UNIQUE,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
    order_index INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    copied_from TEXT,
    scale_paper_inches REAL NOT NULL DEFAULT 1,
    scale_real_feet REAL NOT NULL DEFAULT 4,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS icon_profiles (
    id TEXT PRIMARY KEY,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#1769AA',
    components_json TEXT NOT NULL DEFAULT '[]',
    icon_data TEXT,
    is_shared INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    updated_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS elements (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES icon_profiles(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL DEFAULT 0,
    y DOUBLE PRECISION NOT NULL DEFAULT 0,
    width DOUBLE PRECISION NOT NULL DEFAULT 40,
    height DOUBLE PRECISION NOT NULL DEFAULT 40,
    rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#1769AA',
    z_index INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS element_notes (
    id TEXT PRIMARY KEY,
    element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS element_photos (
    id TEXT PRIMARY KEY,
    element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    caption TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_last_four TEXT NOT NULL,
    email TEXT,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer','installer','editor','manager','admin')),
    max_uses INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    revoked_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
    element_id TEXT REFERENCES elements(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email_attempted TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC);

  CREATE TABLE IF NOT EXISTS survey_reports (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Field report',
    status TEXT NOT NULL DEFAULT 'processing',
    video_storage_key TEXT,
    duration_seconds REAL,
    transcript TEXT,
    report_text TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_survey_reports_survey ON survey_reports(survey_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS survey_report_photos (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES survey_reports(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_survey_report_photos_report ON survey_report_photos(report_id);

  CREATE TABLE IF NOT EXISTS element_checklist_items (
    id TEXT PRIMARY KEY,
    element_id TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
    item_key TEXT,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    status_options_json TEXT NOT NULL DEFAULT '[]',
    is_custom INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_element_checklist_items_element ON element_checklist_items(element_id, sort_order);

  CREATE TABLE IF NOT EXISTS user_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    sender_name TEXT,
    survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
    link_path TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, read_at);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    body_text TEXT,
    is_broadcast INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS message_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

  CREATE TABLE IF NOT EXISTS message_recipients (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON message_recipients(message_id);
  CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON message_recipients(user_id);

  CREATE TABLE IF NOT EXISTS survey_tasks (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    task_name TEXT NOT NULL,
    assigned_to TEXT,
    vendor TEXT,
    start_date TEXT,
    deadline TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_survey_tasks_survey ON survey_tasks(survey_id, deadline);

  CREATE TABLE IF NOT EXISTS task_dependencies (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES survey_tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES survey_tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(task_id, depends_on_task_id)
  );

  CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);

  CREATE TABLE IF NOT EXISTS task_custom_options (
    id TEXT PRIMARY KEY,
    field_type TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(field_type, value)
  );

  CREATE INDEX IF NOT EXISTS idx_task_custom_options_field ON task_custom_options(field_type);

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS survey_assignments (
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (survey_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS site_assignments (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (site_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_site_assignments_user ON site_assignments(user_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
  CREATE INDEX IF NOT EXISTS idx_site_members_user ON site_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_folders_site_parent ON folders(site_id, parent_id, order_index);
  CREATE INDEX IF NOT EXISTS idx_surveys_site_folder ON surveys(site_id, folder_id, order_index);
  CREATE INDEX IF NOT EXISTS idx_elements_survey ON elements(survey_id, z_index);
  CREATE INDEX IF NOT EXISTS idx_notes_element ON element_notes(element_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_photos_element ON element_photos(element_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_survey ON activity_log(survey_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_survey_assignments_user ON survey_assignments(user_id);
  ALTER TABLE surveys ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE surveys ADD COLUMN IF NOT EXISTS scale_paper_inches REAL NOT NULL DEFAULT 1;
  ALTER TABLE surveys ADD COLUMN IF NOT EXISTS scale_real_feet REAL NOT NULL DEFAULT 4;
`;
