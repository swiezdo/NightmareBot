import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../paths.js';
import { GRID_PAGE_COUNT } from '../wizard/constants.js';

const STORE_PATH = path.join(DATA_DIR, 'sessions.json');

function clampGridPage(p) {
  return Math.min(Math.max(0, p ?? 0), GRID_PAGE_COUNT - 1);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(obj) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} userId
 * @returns {object | null}
 */
export function getSession(userId) {
  const all = readAll();
  const row = all[userId];
  if (!row) return null;
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
 * @param {object} row
 */
export function saveSession(row) {
  const all = readAll();
  all[row.userId] = {
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
  writeAll(all);
}

export function deleteSession(userId) {
  const all = readAll();
  delete all[userId];
  writeAll(all);
}
