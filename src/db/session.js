import { getDb } from './database.js';
import { SESSION_TTL_MS } from './session-ttl.js';
import { GRID_PAGE_COUNT } from '../wizard/constants.js';

/** @param {string} userId @param {string} [sourceCommand] */
export function sessionRowKey(userId, sourceCommand = 'setup-waves') {
  return `${userId}:${sourceCommand}`;
}

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
    sourceCommand: row.sourceCommand ?? 'setup-waves',
    locale: row.locale,
    messageId: row.messageId,
    channelId: row.channelId,
    draft: row.draft,
    uiStep: row.uiStep,
    gridPage: clampGridPage(row.gridPage),
    pendingWave: row.pendingWave,
    pendingSpawn: row.pendingSpawn,
    pendingZoneIndex: row.pendingZoneIndex,
    bulkParseError: row.bulkParseError ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * @typedef {{ status: 'ok', session: object } | { status: 'missing' } | { status: 'expired', messageId: string | null, channelId: string | null, locale: 'en' | 'ru' }} SessionLoadResult
 */

/**
 * Загрузка сессии; при истечении TTL строка удаляется, возвращается `status: 'expired'` с данными для правки сообщения в Discord.
 *
 * @param {string} userId
 * @param {'setup-waves' | 'edit-waves'} [sourceCommand]
 * @returns {SessionLoadResult}
 */
export function loadSession(userId, sourceCommand = 'setup-waves') {
  const db = getDb();
  const key = sessionRowKey(userId, sourceCommand);
  const found = db
    .prepare(
      `SELECT payload, updated_at FROM setup_waves_sessions WHERE user_id = ?`,
    )
    .get(key);
  if (!found) return { status: 'missing' };
  const { payload, updated_at } = /** @type {{ payload: string, updated_at: number }} */ (found);
  if (Date.now() - updated_at >= SESSION_TTL_MS) {
    /** @type {{ messageId: string | null, channelId: string | null, locale: 'en' | 'ru' }} */
    let expired = { messageId: null, channelId: null, locale: 'en' };
    try {
      const row = JSON.parse(payload);
      const n = normalizeRow(row);
      expired = {
        messageId: n.messageId ?? null,
        channelId: n.channelId ?? null,
        locale: n.locale === 'ru' ? 'ru' : 'en',
      };
    } catch {
      /* ignore */
    }
    db.prepare(`DELETE FROM setup_waves_sessions WHERE user_id = ?`).run(key);
    return { status: 'expired', ...expired };
  }
  try {
    const row = JSON.parse(payload);
    return { status: 'ok', session: normalizeRow(row) };
  } catch {
    return { status: 'missing' };
  }
}

/**
 * @param {string} userId
 * @param {'setup-waves' | 'edit-waves'} [sourceCommand]
 * @returns {object | null}
 */
export function getSession(userId, sourceCommand = 'setup-waves') {
  const r = loadSession(userId, sourceCommand);
  return r.status === 'ok' ? r.session : null;
}

/**
 * @param {object} row
 */
export function saveSession(row) {
  const db = getDb();
  const toStore = {
    userId: row.userId,
    game: row.game,
    sourceCommand: row.sourceCommand ?? 'setup-waves',
    locale: row.locale ?? null,
    messageId: row.messageId ?? null,
    channelId: row.channelId ?? null,
    draft: row.draft,
    uiStep: row.uiStep,
    gridPage: clampGridPage(row.gridPage),
    pendingWave: row.pendingWave ?? null,
    pendingSpawn: row.pendingSpawn ?? null,
    pendingZoneIndex: row.pendingZoneIndex ?? null,
    bulkParseError: row.bulkParseError ?? null,
    updatedAt: Date.now(),
  };
  db.prepare(
    `
    INSERT OR REPLACE INTO setup_waves_sessions (user_id, payload, updated_at)
    VALUES (@user_id, @payload, @updated_at)
  `,
  ).run({
    user_id: sessionRowKey(String(row.userId), toStore.sourceCommand),
    payload: JSON.stringify(toStore),
    updated_at: toStore.updatedAt,
  });
}

/**
 * @param {string} userId
 * @param {'setup-waves' | 'edit-waves'} sourceCommand
 */
export function deleteSession(userId, sourceCommand = 'setup-waves') {
  const db = getDb();
  db.prepare(`DELETE FROM setup_waves_sessions WHERE user_id = ?`).run(
    sessionRowKey(userId, sourceCommand),
  );
}
