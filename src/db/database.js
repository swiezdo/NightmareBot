import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from '../paths.js';
import { SESSION_TTL_MS } from './session-ttl.js';

export const SESSIONS_TABLE = 'sessions';

/** @type {import('better-sqlite3').default | null} */
let db = null;

/** @param {string} name */
function tableExists(name) {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name);
  return Boolean(row);
}

/** Схема `sessions`; при старой БД — одноразовый RENAME с `setup_waves_sessions`. */
function ensureSessionsTable() {
  const legacy = 'setup_waves_sessions';
  if (tableExists(legacy) && !tableExists(SESSIONS_TABLE)) {
    db.exec(`ALTER TABLE ${legacy} RENAME TO ${SESSIONS_TABLE}`);
    db.exec('DROP INDEX IF EXISTS idx_setup_waves_sessions_updated_at');
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON ${SESSIONS_TABLE} (updated_at)`,
    );
    console.log('[db] Renamed table setup_waves_sessions -> sessions');
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
      user_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON ${SESSIONS_TABLE} (updated_at);
  `);
}

function migrateLegacySessionsJson() {
  const row = /** @type {{ c: number }} */ (
    db.prepare(`SELECT COUNT(*) AS c FROM ${SESSIONS_TABLE}`).get()
  );
  if (row.c > 0) return;

  const legacyPath = path.join(DATA_DIR, 'sessions.json');
  if (!fs.existsSync(legacyPath)) return;

  try {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const all = JSON.parse(raw);
    if (!all || typeof all !== 'object') return;

    const insert = db.prepare(`
      INSERT OR REPLACE INTO ${SESSIONS_TABLE} (user_id, payload, updated_at)
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

  ensureSessionsTable();

  db.exec('DROP TABLE IF EXISTS waves_tsushima_publish;');

  migrateLegacySessionsJson();
  migrateSessionKeysToScoped();

  const staleBefore = Date.now() - SESSION_TTL_MS;
  const expired = db
    .prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE updated_at < ?`)
    .run(staleBefore);
  if (expired.changes > 0) {
    console.log('[db] Removed expired sessions rows:', expired.changes);
  }
}

/** Legacy rows used Discord user_id only; scope to setup-waves so edit-waves can have its own row. */
function migrateSessionKeysToScoped() {
  try {
    const info = db.prepare(
      `
      UPDATE ${SESSIONS_TABLE}
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
