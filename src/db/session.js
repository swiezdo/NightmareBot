import { getDb } from './database.js';
import { GRID_PAGE_COUNT } from '../wizard/constants.js';

function clampGridPage(p) {
  return Math.min(Math.max(0, p ?? 0), GRID_PAGE_COUNT - 1);
}

/**
 * Normalize object loaded from DB payload JSON.
 * @param {object} row
 */
function normalizeRow(row) {
  return {
    userId: row.userId,
    game: row.game,
    locale: row.locale,
    messageId: row.messageId,
    channelId: row.channelId,
    draft: row.draft,
    uiStep: row.uiStep,
    gridPage: clampGridPage(row.gridPage),
    pendingWave: row.pendingWave,
    pendingSpawn: row.pendingSpawn,
    pendingZoneIndex: row.pendingZoneIndex,
    updatedAt: row.updatedAt,
  };
}

/**
 * @param {string} userId
 * @returns {object | null}
 */
export function getSession(userId) {
  const db = getDb();
  const found = db
    .prepare(
      `SELECT payload FROM setup_waves_sessions WHERE user_id = ?`,
    )
    .get(userId);
  if (!found) return null;
  try {
    const row = JSON.parse(/** @type {{ payload: string }} */ (found).payload);
    return normalizeRow(row);
  } catch {
    return null;
  }
}

/**
 * @param {object} row
 */
export function saveSession(row) {
  const db = getDb();
  const toStore = {
    userId: row.userId,
    game: row.game,
    locale: row.locale ?? null,
    messageId: row.messageId ?? null,
    channelId: row.channelId ?? null,
    draft: row.draft,
    uiStep: row.uiStep,
    gridPage: clampGridPage(row.gridPage),
    pendingWave: row.pendingWave ?? null,
    pendingSpawn: row.pendingSpawn ?? null,
    pendingZoneIndex: row.pendingZoneIndex ?? null,
    updatedAt: Date.now(),
  };
  db.prepare(
    `
    INSERT OR REPLACE INTO setup_waves_sessions (user_id, payload, updated_at)
    VALUES (@user_id, @payload, @updated_at)
  `,
  ).run({
    user_id: String(row.userId),
    payload: JSON.stringify(toStore),
    updated_at: toStore.updatedAt,
  });
}

export function deleteSession(userId) {
  const db = getDb();
  db.prepare(`DELETE FROM setup_waves_sessions WHERE user_id = ?`).run(userId);
}
