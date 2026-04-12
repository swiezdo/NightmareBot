import fs from 'node:fs';
import { ROTATION_YOTEI_EN_PATH, ROTATION_YOTEI_RU_PATH } from '../paths.js';

/**
 * @typedef {{
 *   location: string,
 *   zoneEn: string,
 *   zoneRu: string,
 *   spawnLeftEn: string,
 *   spawnLeftRu: string,
 *   spawnMiddleEn: string,
 *   spawnMiddleRu: string,
 *   spawnRightEn: string,
 *   spawnRightRu: string,
 * }} YoteiMapZoneRow
 */

/** @type {readonly ['left', 'middle', 'right']} */
export const YOTEI_SPAWN_SLUGS = ['left', 'middle', 'right'];

/**
 * @param {string} s
 */
function normYoteiToken(s) {
  return String(s)
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Slug локации для API/PUT: из поля `location` в `rotation_yotei_*.json` (например `Burned Garden` → `burned-garden`).
 *
 * @param {string} location
 */
export function toYoteiLocationApiSlug(location) {
  return normYoteiToken(location).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Сопоставить подпись/API `spawn_point` со слотом `left` | `middle` | `right`.
 *
 * @param {string} mapSlug
 * @param {string} locationKey значение `location` зоны (как в JSON)
 * @param {string} spawnPoint подпись или уже `left`/`middle`/`right`
 * @returns {'left' | 'middle' | 'right' | ''}
 */
export function resolveYoteiSpawnPointSlug(mapSlug, locationKey, spawnPoint) {
  const raw = String(spawnPoint ?? '').trim();
  if (!raw) return '';
  const rows = getYoteiMapZoneRows(mapSlug);
  const row = rows.find((z) => z.location === locationKey);
  const p = normYoteiToken(raw);
  if (YOTEI_SPAWN_SLUGS.includes(/** @type {'left'|'middle'|'right'} */ (p))) {
    return /** @type {'left'|'middle'|'right'} */ (p);
  }
  if (!row) return '';
  const ens = [row.spawnLeftEn, row.spawnMiddleEn, row.spawnRightEn];
  const rus = [row.spawnLeftRu, row.spawnMiddleRu, row.spawnRightRu];
  for (let i = 0; i < YOTEI_SPAWN_SLUGS.length; i++) {
    const slug = YOTEI_SPAWN_SLUGS[i];
    const en = normYoteiToken(ens[i] ?? '');
    const ru = normYoteiToken((rus[i] || ens[i]) ?? '');
    if (p && (p === en || p === ru)) return slug;
  }
  return '';
}

/**
 * Подпись спавна для UI (локаль мастера).
 *
 * @param {YoteiMapZoneRow} row
 * @param {'left' | 'middle' | 'right' | ''} slug
 * @param {'en' | 'ru'} locale
 */
export function labelForYoteiSpawnSlug(row, slug, locale) {
  if (!row || !slug) return '';
  if (slug === 'left') return locale === 'en' ? row.spawnLeftEn : row.spawnLeftRu || row.spawnLeftEn;
  if (slug === 'middle') return locale === 'en' ? row.spawnMiddleEn : row.spawnMiddleRu || row.spawnMiddleEn;
  if (slug === 'right') return locale === 'en' ? row.spawnRightEn : row.spawnRightRu || row.spawnRightEn;
  return '';
}

/**
 * @param {unknown} row
 * @returns {{ left: string, middle: string, right: string }}
 */
function readSpawn(row) {
  if (!row || typeof row !== 'object') return { left: '', middle: '', right: '' };
  const o = /** @type {Record<string, unknown>} */ (row);
  const sp = o.spawn && typeof o.spawn === 'object' ? /** @type {Record<string, unknown>} */ (o.spawn) : {};
  return {
    left: String(sp.left ?? '').trim(),
    middle: String(sp.middle ?? '').trim(),
    right: String(sp.right ?? '').trim(),
  };
}

/**
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function mapsArray(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const m = /** @type {Record<string, unknown>} */ (raw).maps;
  return Array.isArray(m) ? m : [];
}

/**
 * Зоны и подписи спавнов (лево/центр/право) для карты из rotation_yotei_*.json.
 *
 * @param {string} mapSlug
 * @returns {YoteiMapZoneRow[]}
 */
export function getYoteiMapZoneRows(mapSlug) {
  const slug = String(mapSlug ?? '').trim();
  if (!slug) return [];

  let rawEn;
  let rawRu;
  try {
    rawEn = JSON.parse(fs.readFileSync(ROTATION_YOTEI_EN_PATH, 'utf8'));
  } catch {
    rawEn = null;
  }
  try {
    rawRu = JSON.parse(fs.readFileSync(ROTATION_YOTEI_RU_PATH, 'utf8'));
  } catch {
    rawRu = null;
  }

  const enMaps = mapsArray(rawEn);
  const ruMaps = mapsArray(rawRu);
  const enMap = enMaps.find((m) => m && typeof m === 'object' && String(/** @type {{ slug?: string }} */ (m).slug) === slug);
  const ruMap = ruMaps.find((m) => m && typeof m === 'object' && String(/** @type {{ slug?: string }} */ (m).slug) === slug);
  const enZones = enMap && typeof enMap === 'object' && Array.isArray(/** @type {{ zones?: unknown }} */ (enMap).zones)
    ? /** @type {{ zones: unknown[] }} */ (enMap).zones
    : [];
  const ruZones = ruMap && typeof ruMap === 'object' && Array.isArray(/** @type {{ zones?: unknown }} */ (ruMap).zones)
    ? /** @type {{ zones: unknown[] }} */ (ruMap).zones
    : [];

  /** @type {YoteiMapZoneRow[]} */
  const out = [];
  for (let i = 0; i < enZones.length; i++) {
    const ze = enZones[i];
    const zr = ruZones[i];
    if (!ze || typeof ze !== 'object') continue;
    const eo = /** @type {Record<string, unknown>} */ (ze);
    const ro = zr && typeof zr === 'object' ? /** @type {Record<string, unknown>} */ (zr) : {};
    const loc = String(eo.location ?? '').trim();
    if (!loc) continue;
    const zoneEn = String(eo.zone ?? loc).trim();
    const zoneRu = String(ro.zone ?? zoneEn).trim();
    const sEn = readSpawn(ze);
    const sRu = readSpawn(zr && typeof zr === 'object' ? zr : ze);
    out.push({
      location: loc,
      zoneEn,
      zoneRu,
      spawnLeftEn: sEn.left,
      spawnLeftRu: sRu.left || sEn.left,
      spawnMiddleEn: sEn.middle,
      spawnMiddleRu: sRu.middle || sEn.middle,
      spawnRightEn: sEn.right,
      spawnRightRu: sRu.right || sEn.right,
    });
  }
  return out;
}
