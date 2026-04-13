import fs from 'node:fs';
import { ROTATION_EN_PATH, ROTATION_RU_PATH } from '../paths.js';

/**
 * @param {unknown} spawns
 * @returns {string[]}
 */
export function normalizeSpawns(spawns) {
  if (Array.isArray(spawns)) return spawns.map(String);
  if (spawns == null) return [];
  return [String(spawns)];
}

/**
 * @param {string} a
 * @param {string} b
 */
export function compareWeekCodes(a, b) {
  const [amaj, amin] = a.split('.').map(Number);
  const [bmaj, bmin] = b.split('.').map(Number);
  if (amaj !== bmaj) return amaj - bmaj;
  return amin - bmin;
}

/**
 * @typedef {object} RotationMap
 * @property {string} slug
 * @property {string} name
 * @property {{ week1?: string, week2?: string, week3?: string }} numbers
 * @property {Array<{ code: string, mod1: string, mod1_icon: string, mod2: string, mod2_icon: string }>} weeks
 * @property {Array<{ zone: string, spawns: string | string[] }>} zones_spawns
 * @property {Record<string, string | number>} objectives
 * @property {Record<string, string>} mods
 */

/**
 * @returns {{ en: RotationMap[], ru: RotationMap[], weeksList: { code: string, labelEn: string, labelRu: string }[] }}
 */
export function loadRotations() {
  const en = /** @type {RotationMap[]} */ (
    JSON.parse(fs.readFileSync(ROTATION_EN_PATH, 'utf8'))
  );
  const ru = /** @type {RotationMap[]} */ (
    JSON.parse(fs.readFileSync(ROTATION_RU_PATH, 'utf8'))
  );

  if (en.length !== ru.length) {
    console.warn('rotation: разная длина EN и RU массивов');
  }

  /** @type {Map<string, { mapIndex: number, code: string }>} */
  const byCode = new Map();

  for (let mapIndex = 0; mapIndex < en.length; mapIndex++) {
    const enMap = en[mapIndex];
    for (const w of enMap.weeks || []) {
      if (byCode.has(w.code)) {
        console.warn(`rotation: дубликат кода недели ${w.code}`);
      }
      byCode.set(w.code, { mapIndex, code: w.code });
    }
  }

  const weeksList = [...byCode.keys()]
    .sort(compareWeekCodes)
    .map((code) => {
      const { mapIndex } = byCode.get(code);
      return {
        code,
        labelEn: `${code} — ${en[mapIndex].name}`,
        labelRu: `${code} — ${ru[mapIndex].name}`,
      };
    });

  return { en, ru, weeksList };
}

/**
 * @param {RotationMap[]} en
 * @param {RotationMap[]} ru
 * @param {string} code
 */
export function findWeekContext(en, ru, code) {
  const c = String(code ?? '').trim();
  if (!c) return null;
  for (let mapIndex = 0; mapIndex < en.length; mapIndex++) {
    const enMap = en[mapIndex];
    const ruMap = ru[mapIndex];
    if (!ruMap) continue;
    const weekEn = enMap.weeks?.find((w) => w.code === c);
    const weekRu = ruMap.weeks?.find((w) => w.code === c);
    if (weekEn && weekRu) {
      return { mapIndex, enMap, ruMap, weekEn, weekRu };
    }
  }
  return null;
}

/**
 * EN zone/spawn → RU labels using paired zones_spawns (same as /waves display).
 *
 * @param {RotationMap} enMap
 * @param {RotationMap} ruMap
 * @param {string} zoneEn
 * @param {string} spawnEn
 * @returns {{ zone: string, spawn: string }}
 */
export function translateZoneSpawn(enMap, ruMap, zoneEn, spawnEn) {
  const enZones = enMap.zones_spawns || [];
  const ruZones = ruMap.zones_spawns || [];
  for (let i = 0; i < enZones.length; i++) {
    const ze = enZones[i];
    const zr = ruZones[i];
    if (!ze || !zr) continue;
    if (ze.zone !== zoneEn) continue;
    const spEn = normalizeSpawns(ze.spawns);
    const spRu = normalizeSpawns(zr.spawns);
    const idx = spEn.indexOf(spawnEn);
    if (idx >= 0 && spRu[idx] != null) {
      return { zone: zr.zone, spawn: spRu[idx] };
    }
    if (spEn.length === 1 && spRu.length >= 1) {
      return { zone: zr.zone, spawn: spRu[0] };
    }
    return { zone: zr.zone, spawn: spawnEn };
  }
  return { zone: zoneEn, spawn: spawnEn };
}

/**
 * @param {object} enObj
 * @param {object} ruObj
 */
function objectivesToTsushima(enObj, ruObj) {
  /** @type {Record<string, { objective_en: string, objective_ru: string, objective_icon: string, objective_num: number }>} */
  const out = {};
  for (let i = 1; i <= 5; i++) {
    const k = `objective${i}`;
    const iconKey = `objective${i}_icon`;
    const numKey = `objective${i}_num`;
    out[`objective_${i}`] = {
      objective_en: String(enObj[k] ?? ''),
      objective_ru: String(ruObj[k] ?? ''),
      objective_icon: String(enObj[iconKey] ?? ''),
      objective_num: Number(enObj[numKey] ?? 0),
    };
  }
  return out;
}

/**
 * @param {{ weekEn: object, weekRu: object, enMap: RotationMap, ruMap: RotationMap }} ctx
 */
export function buildDraftFromWeek(ctx) {
  const { weekEn, weekRu, enMap, ruMap } = ctx;
  return {
    week: weekEn.code,
    credits: '',
    map_slug: enMap.slug,
    map_name_en: enMap.name,
    map_name_ru: ruMap.name,
    mods: [
      {
        mod1_en: weekEn.mod1,
        mod1_ru: weekRu.mod1,
        mod1_icon: weekEn.mod1_icon,
        mod2_en: weekEn.mod2,
        mod2_ru: weekRu.mod2,
        mod2_icon: weekEn.mod2_icon,
      },
    ],
    objectives: objectivesToTsushima(enMap.objectives, ruMap.objectives),
    waves: createEmptyWaves(),
  };
}

function createEmptyWaves() {
  /** @type {Record<string, Record<string, { zone_en: string, zone_ru: string, spawn_en: string, spawn_ru: string }>>} */
  const waves = {};
  for (let w = 1; w <= 15; w++) {
    waves[`wave_${w}`] = {
      '1': { zone_en: '', zone_ru: '', spawn_en: '', spawn_ru: '' },
      '2': { zone_en: '', zone_ru: '', spawn_en: '', spawn_ru: '' },
      '3': { zone_en: '', zone_ru: '', spawn_en: '', spawn_ru: '' },
    };
  }
  return waves;
}

/** Yōtei: 12 волн; слоты 1–4 (для волн 1–9 используются только 1–3). */
export function createEmptyYoteiWaves() {
  /** @type {Record<string, Record<string, { zone_en: string, zone_ru: string, spawn_en: string, spawn_ru: string, attunements: string[] }>>} */
  const waves = {};
  for (let w = 1; w <= 12; w++) {
    waves[`wave_${w}`] = {};
    for (let s = 1; s <= 4; s++) {
      waves[`wave_${w}`][String(s)] = {
        zone_en: '',
        zone_ru: '',
        spawn_en: '',
        spawn_ru: '',
        attunements: [],
      };
    }
  }
  return waves;
}

function emptyObjectives() {
  /** @type {Record<string, { objective_en: string, objective_ru: string, objective_icon: string, objective_num: number }>} */
  const out = {};
  for (let i = 1; i <= 5; i++) {
    out[`objective_${i}`] = {
      objective_en: '',
      objective_ru: '',
      objective_icon: '',
      objective_num: 0,
    };
  }
  return out;
}

/** Draft before a week is selected. */
export function createEmptyDraft() {
  return {
    week: '',
    credits: '',
    map_slug: '',
    map_name_en: '',
    map_name_ru: '',
    mods: [
      {
        mod1_en: '',
        mod1_ru: '',
        mod1_icon: '',
        mod2_en: '',
        mod2_ru: '',
        mod2_icon: '',
      },
    ],
    objectives: emptyObjectives(),
    waves: createEmptyWaves(),
  };
}

/**
 * Черновик Yōtei для мастера и будущего PUT: только неделя цикла, карта (slug), волны, карточки, credits.
 * `week`: 0 — не выбрано, 1–12 — номер недели цикла (число).
 */
export function createEmptyYoteiDraft() {
  return {
    week: 0,
    credits: '',
    map_slug: '',
    waves: createEmptyYoteiWaves(),
    /** @type {string[] | null} */
    challenge_cards_slugs: null,
  };
}

/**
 * @param {unknown} waves
 */
function normalizeYoteiWavesBlock(waves) {
  const out = createEmptyYoteiWaves();
  const w = waves && typeof waves === 'object' ? /** @type {Record<string, unknown>} */ (waves) : {};
  for (let wi = 1; wi <= 12; wi++) {
    const key = `wave_${wi}`;
    const maxS = wi <= 9 ? 3 : 4;
    const srcWave = w[key] && typeof w[key] === 'object' ? /** @type {Record<string, unknown>} */ (w[key]) : {};
    for (let s = 1; s <= maxS; s++) {
      const slot = String(s);
      const srcCell =
        srcWave[slot] && typeof srcWave[slot] === 'object'
          ? /** @type {Record<string, unknown>} */ (srcWave[slot])
          : {};
      out[key][slot] = {
        zone_en: String(srcCell.zone_en ?? ''),
        zone_ru: String(srcCell.zone_ru ?? ''),
        spawn_en: String(srcCell.spawn_en ?? ''),
        spawn_ru: String(srcCell.spawn_ru ?? ''),
        attunements: Array.isArray(srcCell.attunements)
          ? srcCell.attunements.map((x) => String(x).trim()).filter(Boolean)
          : [],
      };
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 */
function normalizeYoteiDraftShape(raw) {
  const base = createEmptyYoteiDraft();
  if (!raw || typeof raw !== 'object') return base;
  const o = /** @type {Record<string, unknown>} */ (raw);

  let weekNum = Number(o.week);
  if (!Number.isInteger(weekNum) || weekNum < 0 || weekNum > 12) {
    const legacy = Number(o.cycle_week);
    weekNum = Number.isInteger(legacy) && legacy >= 0 && legacy <= 12 ? legacy : 0;
  }

  const ccsRaw = o.challenge_cards_slugs ?? o.yotei_challenge_slugs;
  /** @type {string[] | null} */
  let challenge_cards_slugs = base.challenge_cards_slugs;
  if (ccsRaw === null) challenge_cards_slugs = null;
  else if (Array.isArray(ccsRaw)) challenge_cards_slugs = ccsRaw.map((x) => String(x));

  return {
    week: weekNum,
    credits: String(o.credits ?? base.credits),
    map_slug: String(o.map_slug ?? base.map_slug),
    waves: normalizeYoteiWavesBlock(o.waves),
    challenge_cards_slugs,
  };
}

/**
 * Merge a loose object (e.g. from DB payload) into the canonical draft shape.
 * @param {unknown} raw
 * @param {'tsushima' | 'yotei'} [game]
 */
export function normalizeDraftShape(raw, game = 'tsushima') {
  if (game === 'yotei') return normalizeYoteiDraftShape(raw);
  const base = createEmptyDraft();
  if (!raw || typeof raw !== 'object') return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  return {
    week: String(o.week ?? base.week).trim(),
    credits: String(o.credits ?? base.credits),
    map_slug: String(o.map_slug ?? base.map_slug),
    map_name_en: String(o.map_name_en ?? base.map_name_en),
    map_name_ru: String(o.map_name_ru ?? base.map_name_ru),
    mods: normalizeModsBlock(o.mods, base.mods),
    objectives: normalizeObjectivesBlock(o.objectives, base.objectives),
    waves: normalizeWavesBlock(o.waves),
  };
}

/**
 * @param {unknown} mods
 * @param {object[]} baseMods
 */
function normalizeModsBlock(mods, baseMods) {
  const arr = Array.isArray(mods) ? mods : [];
  const first =
    arr[0] && typeof arr[0] === 'object'
      ? /** @type {Record<string, unknown>} */ (arr[0])
      : {};
  const b0 = baseMods[0];
  return [
    {
      mod1_en: String(first.mod1_en ?? b0.mod1_en),
      mod1_ru: String(first.mod1_ru ?? b0.mod1_ru),
      mod1_icon: String(first.mod1_icon ?? b0.mod1_icon),
      mod2_en: String(first.mod2_en ?? b0.mod2_en),
      mod2_ru: String(first.mod2_ru ?? b0.mod2_ru),
      mod2_icon: String(first.mod2_icon ?? b0.mod2_icon),
    },
  ];
}

/**
 * @param {unknown} objectives
 * @param {Record<string, { objective_en: string, objective_ru: string, objective_icon: string, objective_num: number }>} base
 */
function normalizeObjectivesBlock(objectives, base) {
  /** @type {Record<string, { objective_en: string, objective_ru: string, objective_icon: string, objective_num: number }>} */
  const out = { ...base };
  const src = objectives && typeof objectives === 'object' ? /** @type {Record<string, unknown>} */ (objectives) : {};
  for (let i = 1; i <= 5; i++) {
    const k = `objective_${i}`;
    const s = src[k] && typeof src[k] === 'object' ? /** @type {Record<string, unknown>} */ (src[k]) : {};
    const b = base[k];
    out[k] = {
      objective_en: String(s.objective_en ?? b.objective_en),
      objective_ru: String(s.objective_ru ?? b.objective_ru),
      objective_icon: String(s.objective_icon ?? b.objective_icon),
      objective_num: Number(s.objective_num ?? b.objective_num),
    };
  }
  return out;
}

/** @param {unknown} waves */
function normalizeWavesBlock(waves) {
  const out = createEmptyWaves();
  const w = waves && typeof waves === 'object' ? /** @type {Record<string, unknown>} */ (waves) : {};
  for (let wi = 1; wi <= 15; wi++) {
    const key = `wave_${wi}`;
    const srcWave = w[key] && typeof w[key] === 'object' ? /** @type {Record<string, unknown>} */ (w[key]) : {};
    for (let s = 1; s <= 3; s++) {
      const slot = String(s);
      const srcCell =
        srcWave[slot] && typeof srcWave[slot] === 'object'
          ? /** @type {Record<string, unknown>} */ (srcWave[slot])
          : {};
      out[key][slot] = {
        zone_en: String(srcCell.zone_en ?? ''),
        zone_ru: String(srcCell.zone_ru ?? ''),
        spawn_en: String(srcCell.spawn_en ?? ''),
        spawn_ru: String(srcCell.spawn_ru ?? ''),
      };
    }
  }
  return out;
}

export { createEmptyWaves };
