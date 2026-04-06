import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from '../paths.js';

/** @type {import('better-sqlite3').default | null} */
let db = null;

function migrateLegacySessionsJson() {
  const row = /** @type {{ c: number }} */ (
    db.prepare('SELECT COUNT(*) AS c FROM setup_waves_sessions').get()
  );
  if (row.c > 0) return;

  const legacyPath = path.join(DATA_DIR, 'sessions.json');
  if (!fs.existsSync(legacyPath)) return;

  try {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const all = JSON.parse(raw);
    if (!all || typeof all !== 'object') return;

    const insert = db.prepare(`
      INSERT OR REPLACE INTO setup_waves_sessions (user_id, payload, updated_at)
      VALUES (@user_id, @payload, @updated_at)
    `);

    const entries = Object.entries(all);
    const runMigrate = db.transaction(() => {
      for (const [key, rowData] of entries) {
        const userId = String(/** @type {object} */ (rowData).userId ?? key);
        const payloadObj = { .../** @type {object} */ (rowData), userId };
        insert.run({
          user_id: userId,
          payload: JSON.stringify(payloadObj),
          updated_at: Number(/** @type {object} */ (rowData).updatedAt) || Date.now(),
        });
      }
    });

    runMigrate();
    fs.renameSync(legacyPath, path.join(DATA_DIR, 'sessions.json.migrated'));
    console.log('[db] Migrated sessions.json to SQLite; renamed to sessions.json.migrated');
  } catch (e) {
    console.error('[db] Legacy sessions.json migration failed:', e);
  }
}

/**
 * Open DB, create schema, optional one-time migration from sessions.json.
 */
export function initDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_waves_sessions (
      user_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_setup_waves_sessions_updated_at
      ON setup_waves_sessions (updated_at);
  `);

  migrateLegacySessionsJson();
  migrateSessionKeysToScoped();
}

/** Legacy rows used Discord user_id only; scope to setup-waves so edit-waves can have its own row. */
function migrateSessionKeysToScoped() {
  try {
    const info = db.prepare(
      `
      UPDATE setup_waves_sessions
      SET user_id = user_id || ':setup-waves'
      WHERE instr(user_id, ':') = 0
    `,
    ).run();
    if (info.changes > 0) {
      console.log('[db] Scoped session user_id keys:', info.changes);
    }
  } catch (e) {
    console.error('[db] migrateSessionKeysToScoped:', e);
  }
}

/** @returns {import('better-sqlite3').Database} */
export function getDb() {
  if (!db) {
    throw new Error('initDatabase() must run before database access');
  }
  return db;
}
