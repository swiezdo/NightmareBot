import fs from 'node:fs';
import { ROTATION_YOTEI_EN_PATH, ROTATION_YOTEI_RU_PATH } from '../paths.js';
import { createEmptyYoteiDraft } from './rotation.js';

/**
 * @typedef {{ week: number, roundChallenges: string[] | null }} YoteiMapWeekSchedule
 * @typedef {{ en: string, ru: string }} YoteiBilingual
 * @typedef {{ en: string, ru: string, thumbnailUrl: string }} YoteiChallengeMerged
 * @typedef {{
 *   maps: Record<string, YoteiBilingual>,
 *   zones: Record<string, YoteiBilingual>,
 *   zonesByMap: Record<string, Record<string, YoteiBilingual>>,
 *   challengeCards: Record<string, YoteiChallengeMerged>,
 *   scheduleByMapSlug: Record<string, YoteiMapWeekSchedule[]>,
 *   cycleLength: number | null
 * }} YoteiLabels
 */

/**
 * @param {unknown} raw
 * @returns {{ maps: unknown[], zones: unknown[], challenge_cards: unknown[] }}
 */
function parseYoteiRotationRoot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { maps: [], zones: [], challenge_cards: [] };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const maps = Array.isArray(o.maps) ? o.maps : [];
  const zones = Array.isArray(o.zones) ? o.zones : [];
  const challenge_cards = Array.isArray(o.challenge_cards)
    ? o.challenge_cards
    : Array.isArray(o.challengeCards)
      ? o.challengeCards
      : [];
  return { maps, zones, challenge_cards };
}

/**
 * @param {unknown} row
 * @returns {{ slug: string, name: string }}
 */
function mapRow(row) {
  if (!row || typeof row !== 'object') return { slug: '', name: '' };
  const o = /** @type {Record<string, unknown>} */ (row);
  const slug = String(o.slug ?? '').trim();
  const name = String(o.name ?? '').trim();
  return { slug, name };
}

/**
 * @param {unknown} row
 * @returns {unknown[]}
 */
function mapZonesRaw(row) {
  if (!row || typeof row !== 'object') return [];
  const o = /** @type {Record<string, unknown>} */ (row);
  return Array.isArray(o.zones) ? o.zones : [];
}

/**
 * `location` — значение `location` из API; `zone` — подпись на языке файла (как в Tsushima `zones_spawns.zone`).
 *
 * @param {unknown} row
 * @returns {{ location: string, zone: string }}
 */
function zoneRow(row) {
  if (!row || typeof row !== 'object') return { location: '', zone: '' };
  const o = /** @type {Record<string, unknown>} */ (row);
  const location = String(o.location ?? o.api ?? '').trim();
  const zone = String(o.zone ?? o.label ?? o.name ?? '').trim();
  return { location, zone };
}

/**
 * `<:name:id>` / `<a:name:id>` → `cdn.discordapp.com/emojis/{id}.png` или `.gif`.
 *
 * @param {string} raw
 * @returns {string}
 */
function discordEmojiToCdnUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^<(a?):[^:>]+:(\d+)>$/);
  if (!m) return '';
  const id = m[2];
  return m[1] === 'a'
    ? `https://cdn.discordapp.com/emojis/${id}.gif`
    : `https://cdn.discordapp.com/emojis/${id}.png`;
}

/**
 * @param {unknown} row
 * @returns {{ slug: string, line: string, thumbnailUrl: string }}
 */
function challengeRow(row) {
  if (!row || typeof row !== 'object') return { slug: '', line: '', thumbnailUrl: '' };
  const o = /** @type {Record<string, unknown>} */ (row);
  const slug = String(o.slug ?? '').trim();
  const line = String(o.line ?? o.description ?? '').trim();
  const image = String(o.image ?? o.image_url ?? o.imageUrl ?? '').trim();
  const emoji = String(o.emoji ?? '').trim();
  const fromEmoji = discordEmojiToCdnUrl(emoji);
  const thumbnailUrl = fromEmoji || image;
  return { slug, line, thumbnailUrl };
}

/**
 * @param {unknown} mapRow
 * @returns {Array<{ week: number, roundChallenges: string[] | null }>}
 */
function parseMapScheduledWeeks(mapRow) {
  if (!mapRow || typeof mapRow !== 'object') return [];
  const o = /** @type {Record<string, unknown>} */ (mapRow);
  const raw = o.scheduled_weeks ?? o.scheduledWeeks;
  if (!Array.isArray(raw)) return [];

  /** @type {Array<{ week: number, roundChallenges: string[] | null }>} */
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const io = /** @type {Record<string, unknown>} */ (item);
    const week = Number(io.week);
    if (!Number.isInteger(week) || week < 1 || week > 12) {
      console.warn('[yotei-rotation] scheduled_weeks: invalid week (need 1–12)', item);
      continue;
    }
    const rc = io.round_challenges ?? io.roundChallenges;
    if (rc === null || rc === undefined) {
      out.push({ week, roundChallenges: null });
      continue;
    }
    if (!Array.isArray(rc)) {
      console.warn('[yotei-rotation] scheduled_weeks: round_challenges must be array or null', item);
      continue;
    }
    const slugs = rc.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (slugs.length !== 4) {
      console.warn('[yotei-rotation] scheduled_weeks: need exactly 4 slugs when not null', {
        week,
        count: slugs.length,
      });
      continue;
    }
    out.push({ week, roundChallenges: slugs });
  }
  out.sort((a, b) => a.week - b.week);
  return out;
}

/**
 * @param {unknown | null} rawRoot
 * @returns {number | null}
 */
function parseCycleLength(rawRoot) {
  if (!rawRoot || typeof rawRoot !== 'object' || Array.isArray(rawRoot)) return null;
  const o = /** @type {Record<string, unknown>} */ (rawRoot);
  const n = Number(o.cycle_length ?? o.cycleLength);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * @param {string} filePath
 * @returns {unknown | null}
 */
function readJsonOptional(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err.code === 'ENOENT') return null;
    console.warn('[yotei-rotation] failed to read or parse', filePath, e);
    return null;
  }
}

/**
 * @returns {YoteiLabels}
 */
export function loadYoteiLabels() {
  /** @type {YoteiLabels} */
  const empty = {
    maps: {},
    zones: {},
    zonesByMap: {},
    challengeCards: {},
    scheduleByMapSlug: {},
    cycleLength: null,
  };

  const rawEn = readJsonOptional(ROTATION_YOTEI_EN_PATH);
  const rawRu = readJsonOptional(ROTATION_YOTEI_RU_PATH);
  if (rawEn == null && rawRu == null) return empty;

  const en = parseYoteiRotationRoot(rawEn);
  const ru = parseYoteiRotationRoot(rawRu);

  /** @type {Record<string, YoteiBilingual>} */
  const maps = {};
  for (const row of en.maps) {
    const { slug, name } = mapRow(row);
    if (!slug) continue;
    maps[slug] = { en: name, ru: '' };
  }
  for (const row of ru.maps) {
    const { slug, name } = mapRow(row);
    if (!slug) continue;
    if (!maps[slug]) maps[slug] = { en: '', ru: '' };
    maps[slug].ru = name;
  }

  /** @type {Record<string, YoteiBilingual>} */
  const zones = {};
  /** @type {Record<string, Record<string, YoteiBilingual>>} */
  const zonesByMap = {};
  for (const row of en.zones) {
    const { location, zone } = zoneRow(row);
    if (!location) continue;
    zones[location] = { en: zone || location, ru: '' };
  }
  for (const row of ru.zones) {
    const { location, zone } = zoneRow(row);
    if (!location) continue;
    if (!zones[location]) zones[location] = { en: location, ru: '' };
    zones[location].ru = zone || location;
  }

  // Новая схема: зоны вложены в maps[].zones[] и зависят от карты.
  for (const row of en.maps) {
    const { slug } = mapRow(row);
    if (!slug) continue;
    if (!zonesByMap[slug]) zonesByMap[slug] = {};
    for (const z of mapZonesRaw(row)) {
      const { location, zone } = zoneRow(z);
      if (!location) continue;
      zonesByMap[slug][location] = { en: zone || location, ru: '' };
    }
  }
  for (const row of ru.maps) {
    const { slug } = mapRow(row);
    if (!slug) continue;
    if (!zonesByMap[slug]) zonesByMap[slug] = {};
    for (const z of mapZonesRaw(row)) {
      const { location, zone } = zoneRow(z);
      if (!location) continue;
      if (!zonesByMap[slug][location]) {
        zonesByMap[slug][location] = { en: location, ru: '' };
      }
      zonesByMap[slug][location].ru = zone || location;
    }
  }

  /** @type {Record<string, YoteiChallengeMerged>} */
  const challengeCards = {};
  for (const row of en.challenge_cards) {
    const { slug, line, thumbnailUrl } = challengeRow(row);
    if (!slug) continue;
    challengeCards[slug] = { en: line, ru: '', thumbnailUrl };
  }
  for (const row of ru.challenge_cards) {
    const { slug, line, thumbnailUrl } = challengeRow(row);
    if (!slug) continue;
    if (!challengeCards[slug]) challengeCards[slug] = { en: '', ru: '', thumbnailUrl: '' };
    challengeCards[slug].ru = line;
    if (!challengeCards[slug].thumbnailUrl && thumbnailUrl) challengeCards[slug].thumbnailUrl = thumbnailUrl;
  }

  /** @type {Record<string, Array<{ week: number, roundChallenges: string[] | null }>>} */
  const scheduleByMapSlug = {};
  for (const row of en.maps) {
    const { slug } = mapRow(row);
    if (!slug) continue;
    scheduleByMapSlug[slug] = parseMapScheduledWeeks(row);
  }

  const cycleLength = parseCycleLength(rawEn) ?? parseCycleLength(rawRu);

  return { maps, zones, zonesByMap, challengeCards, scheduleByMapSlug, cycleLength };
}

/**
 * Расписание выживания по неделям цикла для карты (из `maps[].scheduled_weeks` в EN JSON).
 *
 * @param {YoteiLabels} labels
 * @param {string} mapSlug
 * @returns {Array<{ week: number, roundChallenges: string[] | null }>}
 */
export function getYoteiMapScheduledWeeks(labels, mapSlug) {
  const key = String(mapSlug ?? '').trim();
  if (!key) return [];
  const rows = labels.scheduleByMapSlug[key];
  return Array.isArray(rows) ? [...rows] : [];
}

/**
 * @param {YoteiLabels} labels
 * @param {string} mapKey `map_slug` / `slug` / fallback `name`
 * @param {'en' | 'ru'} locale
 * @param {string} apiTitle поле `name` карты из API
 */
export function resolveYoteiMapTitle(labels, mapKey, locale, apiTitle) {
  const key = String(mapKey ?? '').trim();
  const api = String(apiTitle ?? '').trim() || key;
  const row = labels.maps[key];
  if (locale === 'en') {
    const v = row?.en?.trim();
    return v || api;
  }
  const v = row?.ru?.trim() || row?.en?.trim();
  return v || api;
}

/**
 * @param {YoteiLabels} labels
 * @param {string} locationFromApi `location` из API
 * @param {'en' | 'ru'} locale
 * @param {string} [mapKey] `map_slug` / `slug` карты; если есть — сначала ищем в `maps[].zones[]`
 */
export function resolveYoteiZone(labels, locationFromApi, locale, mapKey = '') {
  const api = String(locationFromApi ?? '').trim();
  if (!api) return '';
  const mapSlug = String(mapKey ?? '').trim();
  const mapRow = mapSlug ? labels.zonesByMap[mapSlug]?.[api] : null;
  const row = mapRow || labels.zones[api];
  if (locale === 'en') {
    const v = row?.en?.trim();
    return v || api;
  }
  const v = row?.ru?.trim() || row?.en?.trim();
  return v || api;
}

/**
 * Строка карточки в шапке: сначала `line` из rotation JSON, иначе API (`description` / `name`).
 *
 * @param {YoteiLabels} labels
 * @param {string} cardKey slug / `challenge.name` / строка `challenge_card`
 * @param {'en' | 'ru'} locale
 * @param {string} apiLine из API (обычно `description`)
 */
export function resolveYoteiChallengeCard(labels, cardKey, locale, apiLine) {
  const key = String(cardKey ?? '').trim();
  const api = String(apiLine ?? '').trim();
  const row = labels.challengeCards[key];
  if (locale === 'en') {
    const v = row?.en?.trim();
    return v || api || key;
  }
  const v = row?.ru?.trim() || row?.en?.trim();
  return v || api || key;
}

/**
 * URL для `EmbedBuilder.setThumbnail` — из поля `emoji` (Discord mention) или прямой `image` в JSON.
 *
 * @param {YoteiLabels} labels
 * @param {string} cardKey
 * @returns {string | null}
 */
export function resolveYoteiChallengeCardThumbnail(labels, cardKey) {
  const key = String(cardKey ?? '').trim();
  if (!key) return null;
  const u = String(labels.challengeCards[key]?.thumbnailUrl ?? '').trim();
  return u || null;
}

/** Неделя цикла → карта выживания, если в JSON нет явной строки `scheduled_weeks`. */
const YOTEI_WEEK_FALLBACK_SLUG = {
  1: 'frozen-valley',
  2: 'hidden-temple',
  3: 'river-village',
  4: 'broken-castle',
  5: 'frozen-valley',
  6: 'hidden-temple',
  7: 'river-village',
  8: 'broken-castle',
  9: 'frozen-valley',
  10: 'hidden-temple',
  11: 'river-village',
  12: 'broken-castle',
};

/**
 * 12 опций для селекта «неделя цикла + карта выживания».
 *
 * @param {YoteiLabels} labels
 * @param {'en' | 'ru'} locale
 * @returns {Array<{ week: number, mapSlug: string, label: string }>}
 */
/**
 * Черновик после выбора недели цикла в мастере: карта, названия, карточки из `scheduled_weeks`.
 *
 * @param {YoteiLabels} labels
 * @param {number} week 1–12
 * @param {string} mapSlug
 */
export function buildYoteiDraftForCycleWeek(labels, week, mapSlug) {
  const draft = createEmptyYoteiDraft();
  const w = Number(week);
  draft.week = Number.isInteger(w) && w >= 1 && w <= 12 ? w : 0;
  draft.map_slug = String(mapSlug ?? '').trim();
  const sched = getYoteiMapScheduledWeeks(labels, draft.map_slug);
  const row = sched.find((r) => r.week === draft.week);
  draft.challenge_cards_slugs = row ? row.roundChallenges : null;
  return draft;
}

export function buildYoteiCycleWeekSelectOptions(labels, locale) {
  /** @type {Array<{ week: number, mapSlug: string, label: string }>} */
  const out = [];
  const schedule = labels.scheduleByMapSlug ?? {};
  for (let w = 1; w <= 12; w++) {
    let slug = '';
    for (const mapSlug of Object.keys(schedule)) {
      const rows = schedule[mapSlug];
      if (!Array.isArray(rows)) continue;
      if (rows.some((r) => r.week === w)) {
        slug = mapSlug;
        break;
      }
    }
    if (!slug) slug = YOTEI_WEEK_FALLBACK_SLUG[w] ?? 'frozen-valley';
    const title = resolveYoteiMapTitle(labels, slug, locale, slug);
    const label = locale === 'ru' ? `Неделя ${w} — ${title}` : `Week ${w} — ${title}`;
    out.push({ week: w, mapSlug: slug, label });
  }
  return out;
}
