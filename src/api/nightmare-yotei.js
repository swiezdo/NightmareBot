import { createEmptyYoteiDraft } from '../data/rotation.js';
import {
  getYoteiMapZoneRows,
  toYoteiLocationApiSlug,
  resolveYoteiSpawnPointSlug,
  labelForYoteiSpawnSlug,
} from '../data/yotei-map-zones.js';
import { resolveYoteiZone } from '../data/yotei-labels.js';
import { getWaveGridSpec } from '../wizard/game-geometry.js';
import { CREDIT_TEXT_MAX, DEFAULT_TSUSHIMA_CREDIT_TEXT } from './nightmare-tsushima.js';

const DEFAULT_YOTEI_READ_URL = 'https://nightmare.club/api/rotation/yotei';

/**
 * @param {unknown} r
 */
function roundNumber(r) {
  if (!r || typeof r !== 'object') return 0;
  const n = Number(/** @type {Record<string, unknown>} */ (r).round);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {unknown} spawnsRaw
 */
function normalizeYoteiSpawnsList(spawnsRaw) {
  const arr = Array.isArray(spawnsRaw) ? spawnsRaw : [];
  return [...arr]
    .filter((s) => s && typeof s === 'object')
    .sort(
      (a, b) =>
        Number(/** @type {Record<string, unknown>} */ (a).order) -
        Number(/** @type {Record<string, unknown>} */ (b).order),
    );
}

/**
 * URL для GET текущей ротации Yōtei. NIGHTMARE_CLUB_YOTEI_READ_URL;
 * иначе из NIGHTMARE_CLUB_YOTEI_URL: …/api/rotations/yotei → …/api/rotation/yotei.
 */
export function getYoteiRotationReadUrl() {
  const explicit = process.env.NIGHTMARE_CLUB_YOTEI_READ_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const putUrl = process.env.NIGHTMARE_CLUB_YOTEI_URL?.trim();
  if (putUrl) {
    const derived = putUrl.replace(/\/api\/rotations\/yotei\/?$/i, '/api/rotation/yotei');
    if (derived !== putUrl) return derived.replace(/\/$/, '');
  }
  return DEFAULT_YOTEI_READ_URL;
}

/**
 * @param {{ url?: string, token: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export async function fetchYoteiRotationRead(opts) {
  const url = (opts.url ?? getYoteiRotationReadUrl()).replace(/\/$/, '');
  const token = String(opts.token ?? '').trim();
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  /** @type {unknown} */
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

/**
 * Черновик мастера из GET /api/rotation/yotei. Порядок волн: раунд 1…4, внутри каждого раунда волны по полю `wave` (как на сайте).
 * UI-волны 1–12; слоты 3 или 4 по {@link getWaveGridSpec}('yotei').
 *
 * @param {unknown} apiJson
 * @param {import('../data/yotei-labels.js').YoteiLabels} labels
 * @returns {{ ok: true, draft: object, multiMap: boolean } | { ok: false, reason: 'empty_maps' | 'bad_shape' }}
 */
export function buildDraftFromYoteiReadApi(apiJson, labels) {
  if (!apiJson || typeof apiJson !== 'object') {
    return { ok: false, reason: 'bad_shape' };
  }
  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return { ok: false, reason: 'empty_maps' };
  }

  const entry = maps[0];
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'bad_shape' };
  }
  const row = /** @type {Record<string, unknown>} */ (entry);
  const slug = String(row.slug ?? row.map_slug ?? '').trim();
  if (!slug) {
    return { ok: false, reason: 'bad_shape' };
  }

  const draft = createEmptyYoteiDraft();
  draft.map_slug = slug;
  const creditRaw = row.credit_text;
  draft.credits = creditRaw != null ? String(creditRaw) : '';
  draft.week = 0;

  const roundsRaw = Array.isArray(row.rounds) ? row.rounds : [];
  const rounds = [...roundsRaw]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => roundNumber(a) - roundNumber(b));

  /** @type {string[]} */
  const challengeNames = [];
  for (const rd of rounds) {
    const ro = /** @type {Record<string, unknown>} */ (rd);
    const ch = ro.challenge;
    if (ch && typeof ch === 'object') {
      const cn = String(/** @type {Record<string, unknown>} */ (ch).name ?? '').trim();
      challengeNames.push(cn);
    } else {
      challengeNames.push('');
    }
  }
  draft.challenge_cards_slugs = challengeNames.length > 0 ? challengeNames : null;

  const spec = getWaveGridSpec('yotei');
  let uiWave = 0;
  for (const rd of rounds) {
    const ro = /** @type {Record<string, unknown>} */ (rd);
    const wavesArr = Array.isArray(ro.waves) ? [...ro.waves] : [];
    wavesArr.sort((a, b) => {
      const wa = a && typeof a === 'object' ? Number(/** @type {Record<string, unknown>} */ (a).wave) : 0;
      const wb = b && typeof b === 'object' ? Number(/** @type {Record<string, unknown>} */ (b).wave) : 0;
      return (Number.isFinite(wa) ? wa : 0) - (Number.isFinite(wb) ? wb : 0);
    });

    for (const wv of wavesArr) {
      uiWave += 1;
      if (uiWave > spec.totalWaves) break;
      const wo = /** @type {Record<string, unknown>} */ (wv);
      const spawns = normalizeYoteiSpawnsList(wo.spawns);
      const maxSlot = spec.slotsForWave(uiWave);
      const waveKey = `wave_${uiWave}`;
      for (const sp of spawns) {
        const so = /** @type {Record<string, unknown>} */ (sp);
        const order = Number(so.order);
        if (!Number.isFinite(order) || order < 1 || order > maxSlot) continue;
        const loc = String(so.location ?? '').trim();
        const spPoint = String(so.spawn_point ?? '').trim();
        const zoneRu = resolveYoteiZone(labels, loc, 'ru', slug);
        const rows = getYoteiMapZoneRows(slug);
        const row = rows.find((z) => z.location === loc);
        const spSlug = resolveYoteiSpawnPointSlug(slug, loc, spPoint);
        draft.waves[waveKey][String(order)] = {
          zone_en: loc,
          zone_ru: zoneRu || loc,
          spawn_en: spSlug,
          spawn_ru: row && spSlug ? labelForYoteiSpawnSlug(row, spSlug, 'ru') : '',
        };
      }
    }
    if (uiWave >= spec.totalWaves) break;
  }

  return { ok: true, draft, multiMap: maps.length > 1 };
}

/**
 * Тело для будущего `PUT /api/rotations/yotei`: только `week`, `credits`, `map_slug`, `waves`, `challenge_cards_slugs`.
 * В `waves[].spawns[]` — `location` и `spawn` **slug-ами**: локация kebab-case из `zone_en`, спавн `left` | `middle` | `right`.
 *
 * @param {object} draft — `session.draft` для `game === 'yotei'`
 * @returns {{ week: number, credits: string, map_slug: string, waves: object[], challenge_cards_slugs: string[] | null }}
 */
export function buildYoteiApiPayload(draft) {
  const week = Number(draft?.week);
  if (!Number.isInteger(week) || week < 1 || week > 12) {
    throw new Error('Yōtei draft.week must be an integer 1–12');
  }
  const map_slug = String(draft?.map_slug ?? '').trim();
  if (!map_slug) throw new Error('Yōtei draft missing map_slug');

  const spec = getWaveGridSpec('yotei');
  /** @type {{ wave: number, spawns: { order: number, location: string, spawn: string }[] }[]} */
  const waves = [];
  for (let w = 1; w <= spec.totalWaves; w++) {
    const waveObj = draft.waves?.[`wave_${w}`];
    const maxS = spec.slotsForWave(w);
    /** @type {{ order: number, location: string, spawn: string }[]} */
    const spawns = [];
    for (let s = 1; s <= maxS; s++) {
      const cell = waveObj?.[`${s}`];
      const locKey = String(cell?.zone_en ?? '').trim();
      const spawnRaw = String(cell?.spawn_en ?? '').trim();
      const spawnSlug =
        spawnRaw === 'left' || spawnRaw === 'middle' || spawnRaw === 'right'
          ? spawnRaw
          : resolveYoteiSpawnPointSlug(map_slug, locKey, spawnRaw);
      spawns.push({
        order: s,
        location: toYoteiLocationApiSlug(locKey),
        spawn: spawnSlug,
      });
    }
    waves.push({ wave: w, spawns });
  }

  const raw = String(draft?.credits ?? '').trim();
  const credits = (raw || DEFAULT_TSUSHIMA_CREDIT_TEXT).slice(0, CREDIT_TEXT_MAX);

  const ccs = draft?.challenge_cards_slugs;
  /** @type {string[] | null} */
  const challenge_cards_slugs =
    ccs === null || ccs === undefined
      ? null
      : Array.isArray(ccs)
        ? ccs.map((x) => String(x))
        : null;

  return {
    week,
    credits,
    map_slug,
    waves,
    challenge_cards_slugs,
  };
}
