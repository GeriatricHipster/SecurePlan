import assert from 'node:assert/strict';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { createPostgresDatabase } from '../../server/lib/postgres.js';

test('PostgreSQL adapter initializes the Supabase schema and executes transactional writes', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const database = createPostgresDatabase({ databaseUrl: 'postgresql://test', databaseSsl: false }, new Pool());
  await database.ready;

  const profiles = await database.prepare('SELECT id FROM icon_profiles ORDER BY id').all();
  assert.equal(profiles.length, 3);

  const user = {
    id: 'user-1', name: 'Owner', email: 'owner@example.com', passwordHash: 'test', now: new Date().toISOString(),
  };
  await database.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, role, workspace_access, token_version, created_at, updated_at)
     VALUES (@id, @name, @email, @passwordHash, 'owner', 1, 0, @now, @now)`,
  ).run(user);

  await database.transaction(async () => {
    await database.prepare(
      `INSERT INTO sites
        (id, name, order_index, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    ).run('site-1', 'Postgres test', user.id, user.id, user.now, user.now);
  })();
  assert.equal((await database.prepare('SELECT id FROM sites WHERE id = ?').get('site-1')).id, 'site-1');

  await database.close();
});
