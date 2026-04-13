import { createEmptyYoteiDraft } from '../data/rotation.js';
import {
  getYoteiMapZoneRows,
  toYoteiLocationApiSlug,
  resolveYoteiSpawnPointSlug,
  labelForYoteiSpawnSlug,
} from '../data/yotei-map-zones.js';
import { resolveYoteiZone, resolveYoteiMapTitle } from '../data/yotei-labels.js';
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
 * URL для PUT (`/api/rotations/yotei`). Явный **NIGHTMARE_CLUB_YOTEI_URL**;
 * иначе из read URL: …/api/rotation/yotei → …/api/rotations/yotei.
 *
 * @returns {string} пустая строка, если вывести нельзя
 */
export function getYoteiRotationPutUrl() {
  const explicitPut = process.env.NIGHTMARE_CLUB_YOTEI_URL?.trim();
  if (explicitPut) return explicitPut.replace(/\/$/, '');

  const readUrl = getYoteiRotationReadUrl();
  const derived = readUrl.replace(/\/api\/rotation\/yotei\/?$/i, '/api/rotations/yotei');
  if (derived !== readUrl) return derived.replace(/\/$/, '');

  return '';
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ url: string, token: string }} options
 * @returns {Promise<{ ok: boolean, status: number, json: unknown }>}
 */
export async function pushYoteiToNightmare(payload, { url, token }) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  /** @type {unknown} */
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _parse_error: true, _raw: text.slice(0, 500) };
  }

  const bodyOk =
    json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    /** @type {{ ok?: boolean }} */ (json).ok === true;

  return { ok: res.ok && bodyOk, status: res.status, json };
}

/**
 * @param {unknown} w
 */
function isCanonicalWaveShape(w) {
  if (!w || typeof w !== 'object') return false;
  const o = /** @type {Record<string, unknown>} */ (w);
  const wave = Number(o.wave);
  if (!Number.isFinite(wave) || wave < 1 || wave > 12) return false;
  if (!Array.isArray(o.spawns)) return false;
  for (const s of o.spawns) {
    if (!s || typeof s !== 'object') return false;
    const sp = /** @type {Record<string, unknown>} */ (s);
    const ord = Number(sp.order);
    if (!Number.isFinite(ord) || ord < 1) return false;
    if (typeof sp.location !== 'string') return false;
    if (typeof sp.spawn !== 'string') return false;
    if (sp.attunements !== undefined && !Array.isArray(sp.attunements)) return false;
  }
  return true;
}

/**
 * Плоский объект ротации Yōtei (как для PUT): `week`, `credits`, `map_slug`, `waves`, `challenge_cards_slugs`.
 *
 * @param {unknown} o
 */
export function isYoteiCanonicalApiObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = /** @type {Record<string, unknown>} */ (o);
  const mapSlug = String(r.map_slug ?? r.slug ?? '').trim();
  if (!mapSlug) return false;
  if (!Array.isArray(r.waves) || r.waves.length === 0) return false;
  return r.waves.every(isCanonicalWaveShape);
}

/**
 * @param {Record<string, unknown>} row
 */
function normalizeCanonicalFromShape(row) {
  const map_slug = String(row.map_slug ?? row.slug ?? '').trim();
  const weekRaw = Number(row.week);
  const week = Number.isInteger(weekRaw) && weekRaw >= 1 && weekRaw <= 12 ? weekRaw : 0;
  const creditsRaw = row.credits ?? row.credit_text;
  const credits = creditsRaw != null ? String(creditsRaw) : '';

  const spec = getWaveGridSpec('yotei');
  /** @type {Map<number, { order: number, location: string, spawn: string, attunements: string[] }[]>} */
  const byWave = new Map();
  const wavesIn = Array.isArray(row.waves) ? row.waves : [];
  for (const w of wavesIn) {
    if (!isCanonicalWaveShape(w)) continue;
    const wo = /** @type {Record<string, unknown>} */ (w);
    const waveNum = Number(wo.wave);
    const spawnsRaw = wo.spawns;
    const arr = Array.isArray(spawnsRaw) ? spawnsRaw : [];
    /** @type {{ order: number, location: string, spawn: string, attunements: string[] }[]} */
    const spawns = [];
    for (const s of arr) {
      if (!s || typeof s !== 'object') continue;
      const sp = /** @type {Record<string, unknown>} */ (s);
      const order = Number(sp.order);
      if (!Number.isFinite(order) || order < 1) continue;
      spawns.push({
        order,
        location: String(sp.location ?? '').trim(),
        spawn: String(sp.spawn ?? '').trim(),
        attunements: Array.isArray(sp.attunements)
          ? sp.attunements.map((x) => String(x).trim()).filter(Boolean)
          : [],
      });
    }
    spawns.sort((a, b) => a.order - b.order);
    byWave.set(waveNum, spawns);
  }

  /** @type {{ wave: number, spawns: { order: number, location: string, spawn: string, attunements: string[] }[] }[]} */
  const waves = [];
  for (let wn = 1; wn <= spec.totalWaves; wn++) {
    const maxS = spec.slotsForWave(wn);
    const existing = byWave.get(wn) ?? [];
    const byOrd = new Map(existing.map((x) => [x.order, x]));
    /** @type {{ order: number, location: string, spawn: string, attunements: string[] }[]} */
    const spawns = [];
    for (let ord = 1; ord <= maxS; ord++) {
      const ex = byOrd.get(ord);
      if (ex) {
        spawns.push({
          order: ord,
          location: ex.location,
          spawn: ex.spawn,
          attunements: ex.attunements ?? [],
        });
      } else {
        spawns.push({ order: ord, location: '', spawn: '', attunements: [] });
      }
    }
    waves.push({ wave: wn, spawns });
  }

  const ccsRaw = row.challenge_cards_slugs;
  /** @type {string[] | null} */
  let challenge_cards_slugs =
    ccsRaw === null || ccsRaw === undefined
      ? null
      : Array.isArray(ccsRaw)
        ? ccsRaw.map((x) => String(x))
        : null;

  return {
    week,
    credits,
    map_slug,
    waves,
    challenge_cards_slugs,
  };
}

/**
 * @param {unknown} rd
 */
function legacyRoundChallengeSlug(rd) {
  if (!rd || typeof rd !== 'object') return '';
  const ro = /** @type {Record<string, unknown>} */ (rd);
  const direct = ro.challenge_card ?? ro.challengeCard;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (direct && typeof direct === 'object') {
    const d = /** @type {Record<string, unknown>} */ (direct);
    const n = String(d.name ?? '').trim();
    if (n) return n;
  }
  const ch = ro.challenge;
  if (ch && typeof ch === 'object') {
    const cn = String(/** @type {Record<string, unknown>} */ (ch).name ?? '').trim();
    if (cn) return cn;
  }
  return '';
}

/**
 * Старый ответ `maps[].{ slug, rounds, credit_text }` → канонический объект (как PUT).
 *
 * @param {Record<string, unknown>} entry
 */
function legacyMapsEntryToCanonical(entry) {
  const map_slug = String(entry.slug ?? entry.map_slug ?? '').trim();
  if (!map_slug) return null;

  const weekRaw = Number(entry.week);
  const week = Number.isInteger(weekRaw) && weekRaw >= 1 && weekRaw <= 12 ? weekRaw : 0;
  const credits = entry.credit_text != null ? String(entry.credit_text) : '';

  const roundsRaw = Array.isArray(entry.rounds) ? entry.rounds : [];
  const rounds = [...roundsRaw]
    .filter((r) => r && typeof r === 'object')
    .sort((a, b) => roundNumber(a) - roundNumber(b));

  /** @type {string[]} */
  const challengeSlugs = [];
  for (const rd of rounds) {
    challengeSlugs.push(legacyRoundChallengeSlug(rd));
  }
  const challenge_cards_slugs = challengeSlugs.some((x) => x) ? challengeSlugs : null;

  const spec = getWaveGridSpec('yotei');
  /** @type {Map<number, { order: number, location: string, spawn: string, attunements: string[] }[]>} */
  const byGlobalWave = new Map();
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
      /** @type {{ order: number, location: string, spawn: string, attunements: string[] }[]} */
      const list = [];
      for (const sp of spawns) {
        const so = /** @type {Record<string, unknown>} */ (sp);
        const order = Number(so.order);
        if (!Number.isFinite(order) || order < 1 || order > maxSlot) continue;
        const loc = String(so.location ?? '').trim();
        const spPoint = String(so.spawn_point ?? '').trim();
        const locSlug = toYoteiLocationApiSlug(loc);
        const spawnSlug = resolveYoteiSpawnPointSlug(map_slug, loc, spPoint);
        const attunements = Array.isArray(so.attunements)
          ? so.attunements.map((x) => String(x).trim()).filter(Boolean)
          : Array.isArray(so.element)
            ? so.element.map((x) => String(x).trim()).filter(Boolean)
            : [];
        list.push({ order, location: locSlug, spawn: spawnSlug, attunements });
      }
      list.sort((a, b) => a.order - b.order);
      byGlobalWave.set(uiWave, list);
    }
    if (uiWave >= spec.totalWaves) break;
  }

  /** @type {{ wave: number, spawns: { order: number, location: string, spawn: string, attunements: string[] }[] }[]} */
  const waves = [];
  for (let wn = 1; wn <= spec.totalWaves; wn++) {
    const maxS = spec.slotsForWave(wn);
    const existing = byGlobalWave.get(wn) ?? [];
    const byOrd = new Map(existing.map((x) => [x.order, x]));
    /** @type {{ order: number, location: string, spawn: string, attunements: string[] }[]} */
    const spawns = [];
    for (let ord = 1; ord <= maxS; ord++) {
      const ex = byOrd.get(ord);
      if (ex) {
        spawns.push({
          order: ord,
          location: ex.location,
          spawn: ex.spawn,
          attunements: ex.attunements ?? [],
        });
      } else {
        spawns.push({ order: ord, location: '', spawn: '', attunements: [] });
      }
    }
    waves.push({ wave: wn, spawns });
  }

  return {
    week,
    credits,
    map_slug,
    waves,
    challenge_cards_slugs,
  };
}

/**
 * Разбор тела GET (плоский канон, либо `maps[0]` с каноном или legacy `rounds`).
 *
 * @param {unknown} data
 * @returns {ReturnType<typeof normalizeCanonicalFromShape> | null}
 */
export function parseYoteiApiBodyToCanonical(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const root = /** @type {Record<string, unknown>} */ (data);

  if (isYoteiCanonicalApiObject(root)) {
    return normalizeCanonicalFromShape(root);
  }

  const maps = root.maps;
  if (Array.isArray(maps) && maps.length > 0) {
    const m0 = maps[0];
    if (m0 && typeof m0 === 'object') {
      const m = /** @type {Record<string, unknown>} */ (m0);
      if (isYoteiCanonicalApiObject(m)) {
        return normalizeCanonicalFromShape(m);
      }
      return legacyMapsEntryToCanonical(m);
    }
  }

  return null;
}

/**
 * Канон API → черновик мастера (те же ячейки, что после редактирования).
 *
 * @param {ReturnType<typeof normalizeCanonicalFromShape>} canonical
 * @param {import('../data/yotei-labels.js').YoteiLabels} labels
 */
export function canonicalToDraft(canonical, labels) {
  const draft = createEmptyYoteiDraft();
  draft.map_slug = canonical.map_slug;
  draft.week = canonical.week;
  draft.credits = canonical.credits;
  draft.challenge_cards_slugs = canonical.challenge_cards_slugs;

  const map_slug = canonical.map_slug;
  const spec = getWaveGridSpec('yotei');
  const wavesBy = new Map(canonical.waves.map((w) => [w.wave, w]));

  for (let w = 1; w <= spec.totalWaves; w++) {
    const waveEntry = wavesBy.get(w);
    const maxS = spec.slotsForWave(w);
    const waveKey = `wave_${w}`;
    for (let s = 1; s <= maxS; s++) {
      const spawns = waveEntry?.spawns;
      const slotObj =
        Array.isArray(spawns) && spawns.length
          ? spawns.find((p) => p && typeof p === 'object' && Number(/** @type {Record<string, unknown>} */ (p).order) === s)
          : null;
      if (!slotObj || typeof slotObj !== 'object') continue;
      const so = /** @type {Record<string, unknown>} */ (slotObj);
      const locSlug = String(so.location ?? '').trim();
      if (!locSlug) continue;
      const spawnCanon = String(so.spawn ?? '').trim();
      const rows = getYoteiMapZoneRows(map_slug);
      const row =
        rows.find((z) => toYoteiLocationApiSlug(z.location) === locSlug) ??
        rows.find((z) => z.location === locSlug);
      const locKey = row ? row.location : locSlug;
      const zoneRu = resolveYoteiZone(labels, locKey, 'ru', map_slug) || locKey;
      const spawnSlug =
        spawnCanon === 'left' || spawnCanon === 'middle' || spawnCanon === 'right'
          ? spawnCanon
          : resolveYoteiSpawnPointSlug(map_slug, locKey, spawnCanon);
      const attunements = Array.isArray(so.attunements)
        ? so.attunements.map((x) => String(x).trim()).filter(Boolean)
        : [];
      draft.waves[waveKey][String(s)] = {
        zone_en: locKey,
        zone_ru: zoneRu,
        spawn_en: spawnSlug,
        spawn_ru: row && spawnSlug ? labelForYoteiSpawnSlug(row, spawnSlug, 'ru') : '',
        attunements,
      };
    }
  }
  return draft;
}

/**
 * Канон → одна запись `maps[]` с `rounds` для {@link formatYoteiRotationEmbedPayloads}.
 *
 * @param {ReturnType<typeof normalizeCanonicalFromShape>} canonical
 * @param {import('../data/yotei-labels.js').YoteiLabels} labels
 */
export function canonicalToLegacyMapForEmbeds(canonical, labels) {
  const mapKey = canonical.map_slug;
  const nameEn = resolveYoteiMapTitle(labels, mapKey, 'en', mapKey);

  const ccs = canonical.challenge_cards_slugs;
  /** @type {object[]} */
  const rounds = [];
  for (let r = 1; r <= 4; r++) {
    const wavesInRound = [];
    for (let wi = 1; wi <= 3; wi++) {
      const globalWave = (r - 1) * 3 + wi;
      const waveEntry = canonical.waves.find((wv) => wv.wave === globalWave);
      /** @type {object[]} */
      const spawns = [];
      if (waveEntry) {
        for (const sp of waveEntry.spawns) {
          const locSlug = String(sp.location ?? '').trim();
          if (!locSlug && !String(sp.spawn ?? '').trim()) continue;
          const rows = getYoteiMapZoneRows(mapKey);
          const row =
            rows.find((z) => toYoteiLocationApiSlug(z.location) === locSlug) ??
            rows.find((z) => z.location === locSlug);
          const locDisplay = row ? row.location : locSlug;
          spawns.push({
            order: sp.order,
            location: locDisplay,
            spawn_point: sp.spawn,
            attunements: Array.isArray(sp.attunements)
              ? sp.attunements.map((x) => String(x).trim()).filter(Boolean)
              : [],
          });
        }
      }
      wavesInRound.push({ wave: wi, spawns });
    }
    const chSlug = Array.isArray(ccs) && ccs[r - 1] != null ? String(ccs[r - 1]).trim() : '';
    rounds.push({
      round: r,
      waves: wavesInRound,
      ...(chSlug ? { challenge: { name: chSlug } } : {}),
    });
  }

  return {
    slug: mapKey,
    map_slug: mapKey,
    name: nameEn,
    credit_text: canonical.credits,
    rounds,
  };
}

/**
 * Ответ API → `{ maps: [...] }` для рендера embed'ов (канон или legacy без изменений).
 *
 * @param {unknown} apiJson
 * @param {import('../data/yotei-labels.js').YoteiLabels} labels
 * @returns {{ maps: object[] } | null}
 */
export function normalizeYoteiApiJsonForEmbeds(apiJson, labels) {
  const c = parseYoteiApiBodyToCanonical(apiJson);
  if (c) {
    return { maps: [canonicalToLegacyMapForEmbeds(c, labels)] };
  }
  const maps =
    apiJson && typeof apiJson === 'object' && Array.isArray(/** @type {{ maps?: unknown }} */ (apiJson).maps)
      ? /** @type {{ maps: unknown[] }} */ (apiJson).maps
      : null;
  if (maps && maps.length > 0) {
    const filtered = maps.filter((m) => m && typeof m === 'object');
    return filtered.length > 0 ? { maps: filtered } : null;
  }
  return null;
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
 * Черновик мастера из GET: плоский канон (как PUT) или `maps[0]` (канон / legacy `rounds`).
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
  if (Array.isArray(maps) && maps.length === 0) {
    return { ok: false, reason: 'empty_maps' };
  }

  const canonical = parseYoteiApiBodyToCanonical(apiJson);
  if (!canonical || !canonical.map_slug) {
    return { ok: false, reason: 'bad_shape' };
  }

  const multiMap = Array.isArray(maps) && maps.length > 1;
  const draft = canonicalToDraft(canonical, labels);
  return { ok: true, draft, multiMap };
}

/**
 * Тело для `PUT /api/rotations/yotei`: `week`, `credits`, `map_slug`, `waves`, `challenge_cards_slugs`.
 * В `waves[].spawns[]` — `location` и `spawn` **slug-ами**.
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
      const attunements = Array.isArray(cell?.attunements)
        ? cell.attunements.map((x) => String(x).trim()).filter(Boolean)
        : [];
      spawns.push({
        order: s,
        location: toYoteiLocationApiSlug(locKey),
        spawn: spawnSlug,
        ...(attunements.length > 0 ? { attunements } : {}),
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
