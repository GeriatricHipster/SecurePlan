import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { createPostgresDatabase } from './lib/postgres.js';

export function createDatabase(config) {
  if (config.databaseUrl) return createPostgresDatabase(config);
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
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
      updated_at TEXT NOT NULL,
      UNIQUE (site_id, parent_id, name)
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
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 40,
      height REAL NOT NULL DEFAULT 40,
      rotation REAL NOT NULL DEFAULT 0,
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
      email TEXT COLLATE NOCASE,
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

    CREATE INDEX IF NOT EXISTS idx_site_members_user ON site_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_folders_site_parent ON folders(site_id, parent_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_surveys_site_folder ON surveys(site_id, folder_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_elements_survey ON elements(survey_id, z_index);
    CREATE INDEX IF NOT EXISTS idx_notes_element ON element_notes(element_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_photos_element ON element_photos(element_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_survey ON activity_log(survey_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_survey_assignments_user ON survey_assignments(user_id);
  `);

  // Lightweight forward migrations for databases created by an earlier preview build.
  const siteColumns = new Set(db.prepare('PRAGMA table_info(sites)').all().map((column) => column.name));
  if (!siteColumns.has('address')) db.exec('ALTER TABLE sites ADD COLUMN address TEXT');
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!userColumns.has('workspace_access')) {
    db.exec('ALTER TABLE users ADD COLUMN workspace_access INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE users SET workspace_access = 1 WHERE role IN ('owner','admin')");
  }
  const surveyColumns = new Set(db.prepare('PRAGMA table_info(surveys)').all().map((column) => column.name));
  if (!surveyColumns.has('description')) db.exec('ALTER TABLE surveys ADD COLUMN description TEXT');
  if (!surveyColumns.has('scale_paper_inches')) db.exec('ALTER TABLE surveys ADD COLUMN scale_paper_inches REAL NOT NULL DEFAULT 1');
  if (!surveyColumns.has('scale_real_feet')) db.exec('ALTER TABLE surveys ADD COLUMN scale_real_feet REAL NOT NULL DEFAULT 4');

  seedBuiltInProfiles(db);
  return createAsyncSqliteAdapter(db);
}

function createAsyncSqliteAdapter(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        get: async (...args) => statement.get(...args),
        all: async (...args) => statement.all(...args),
        run: async (...args) => statement.run(...args),
      };
    },
    transaction(operation) {
      // Local development and tests use SQLite. Production uses the PostgreSQL
      // adapter above, which provides true async transactions.
      return async (...args) => operation(...args);
    },
    close: async () => database.close(),
  };
}

function seedBuiltInProfiles(db) {
  const now = new Date().toISOString();
  const profiles = [
    {
      id: 'builtin-full-door',
      name: 'Full Door',
      category: 'Doors',
      description: 'Card reader, door position switch, request-to-exit, and door lock.',
      color: '#DC2626',
      components: [
        { category: 'access_control', type: 'card_reader', label: 'Card Reader', symbol: 'CR', offsetX: -0.032, offsetY: 0 },
        { category: 'access_control', type: 'door_position', label: 'Door Position Switch', symbol: 'DPS', offsetX: 0, offsetY: -0.038 },
        { category: 'access_control', type: 'request_to_exit', label: 'Request to Exit', symbol: 'REX', offsetX: 0.032, offsetY: 0 },
        { category: 'access_control', type: 'door_lock', label: 'Door Lock', symbol: 'DL', offsetX: 0, offsetY: 0.038 },
      ],
    },
    {
      id: 'builtin-card-reader-door',
      name: 'Reader Door',
      category: 'Access Control',
      description: 'Card reader and electrified lock.',
      color: '#E11D48',
      components: [
        { category: 'access_control', type: 'card_reader', label: 'Card Reader', symbol: 'CR', offsetX: -0.024, offsetY: 0 },
        { category: 'access_control', type: 'door_lock', label: 'Door Lock', symbol: 'DL', offsetX: 0.024, offsetY: 0 },
      ],
    },
    {
      id: 'builtin-camera-station',
      name: 'Camera Station',
      category: 'CCTV',
      description: 'Camera placement with a field-of-view marker.',
      color: '#2563EB',
      components: [{ category: 'cctv', type: 'fixed_camera', label: 'Fixed Camera', symbol: 'CAM', offsetX: 0, offsetY: 0 }],
    },
  ];

  const insert = db.prepare(`
    INSERT INTO icon_profiles
      (id, site_id, name, category, description, color, components_json, icon_data,
       is_shared, is_builtin, created_by, updated_by, created_at, updated_at)
    VALUES
      (@id, NULL, @name, @category, @description, @color, @componentsJson, NULL,
       1, 1, NULL, NULL, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      color = excluded.color,
      components_json = excluded.components_json,
      is_shared = 1,
      is_builtin = 1,
      updated_at = excluded.updated_at
  `);
  const transaction = db.transaction(() => {
    for (const profile of profiles) {
      insert.run({ ...profile, componentsJson: JSON.stringify(profile.components), now });
    }
  });
  transaction();
}

export async function seedOwnerDemo(db, ownerId) {
  const now = new Date().toISOString();
  const siteId = crypto.randomUUID();
  const buildingId = crypto.randomUUID();
  const floorId = crypto.randomUUID();
  const surveyId = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO sites
      (id, name, address, description, order_index, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(
    siteId,
    'Demo Campus',
    '123 Example Way',
    'A sample site to explore SecurePlan. Rename or delete it whenever you are ready.',
    ownerId,
    ownerId,
    now,
    now,
  );
  await db.prepare(
    `INSERT INTO site_members (site_id, user_id, role, added_by, created_at, updated_at)
     VALUES (?, ?, 'admin', ?, ?, ?)`,
  ).run(siteId, ownerId, ownerId, now, now);
  await db.prepare(
    `INSERT INTO folders
      (id, site_id, parent_id, name, order_index, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, NULL, 'Student Center', 0, ?, ?, ?, ?)`,
  ).run(buildingId, siteId, ownerId, ownerId, now, now);
  await db.prepare(
    `INSERT INTO folders
      (id, site_id, parent_id, name, order_index, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'First Floor', 0, ?, ?, ?, ?)`,
  ).run(floorId, siteId, buildingId, ownerId, ownerId, now, now);
  await db.prepare(
    `INSERT INTO surveys
      (id, site_id, folder_id, name, original_filename, storage_key, mime_type, size_bytes,
       rotation, order_index, version, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'First Floor Survey', NULL, NULL, NULL, 0, 0, 0, 1, ?, ?, ?, ?)`,
  ).run(surveyId, siteId, floorId, ownerId, ownerId, now, now);

  return { siteId, buildingId, floorId, surveyId };
}

export async function logActivity(db, { siteId = null, surveyId = null, elementId = null, actorId, action, details = {} }) {
  await db.prepare(
    `INSERT INTO activity_log
      (id, site_id, survey_id, element_id, actor_id, action, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    siteId,
    surveyId,
    elementId,
    actorId,
    action,
    JSON.stringify(details),
    new Date().toISOString(),
  );
}

export async function logSecurityEvent(db, { eventType, severity = 'info', userId = null, emailAttempted = null, req = null, details = {} }) {
  try {
    const ipAddress = req ? (req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null) : null;
    const userAgent = req ? (req.headers['user-agent'] || null) : null;
    await db.prepare(
      `INSERT INTO security_events
        (id, event_type, severity, user_id, email_attempted, ip_address, user_agent, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      eventType,
      severity,
      userId,
      emailAttempted,
      ipAddress,
      userAgent,
      JSON.stringify(details),
      new Date().toISOString(),
    );
  } catch (error) {
    // Never let a logging failure block the actual security-relevant action (a failed login should still fail cleanly).
    console.error('Failed to record security event:', error.message);
  }
}

export async function touchSurvey(db, surveyId, userId) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE surveys
        SET updated_by = ?, updated_at = ?, version = version + 1
      WHERE id = ?`,
  ).run(userId, now, surveyId);
  return db.prepare('SELECT version, updated_at FROM surveys WHERE id = ?').get(surveyId);
}
