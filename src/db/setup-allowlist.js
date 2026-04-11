import { getDb, WAVES_SETUP_ALLOWLIST_TABLE } from './database.js';

/**
 * @typedef {{ user_id: string, display_name: string, added_at: number, added_by: string }} SetupAllowlistRow
 */

/**
 * @param {string} userId
 * @returns {boolean}
 */
export function isUserInSetupAllowlistTable(userId) {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM ${WAVES_SETUP_ALLOWLIST_TABLE} WHERE user_id = ?`)
    .get(id);
  return Boolean(row);
}

/**
 * @returns {SetupAllowlistRow[]}
 */
export function listSetupAllowlistUsers() {
  return /** @type {SetupAllowlistRow[]} */ (
    getDb()
      .prepare(
        `SELECT user_id, display_name, added_at, added_by
         FROM ${WAVES_SETUP_ALLOWLIST_TABLE}
         ORDER BY added_at ASC`,
      )
      .all()
  );
}

/**
 * @param {string} userId
 * @param {string} displayName
 * @param {string} addedBy
 * @returns {{ inserted: boolean }}
 */
export function addSetupAllowlistUser(userId, displayName, addedBy) {
  const uid = String(userId ?? '').trim();
  const name = String(displayName ?? '').trim() || uid;
  const by = String(addedBy ?? '').trim();
  if (!uid || !by) return { inserted: false };
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO ${WAVES_SETUP_ALLOWLIST_TABLE}
       (user_id, display_name, added_at, added_by)
       VALUES (?, ?, ?, ?)`,
    )
    .run(uid, name, Date.now(), by);
  return { inserted: info.changes > 0 };
}

/**
 * @param {string} userId
 * @returns {boolean} true if a row was removed
 */
export function removeSetupAllowlistUser(userId) {
  const uid = String(userId ?? '').trim();
  if (!uid) return false;
  const info = getDb()
    .prepare(`DELETE FROM ${WAVES_SETUP_ALLOWLIST_TABLE} WHERE user_id = ?`)
    .run(uid);
  return info.changes > 0;
}
