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
  for (let mapIndex = 0; mapIndex < en.length; mapIndex++) {
    const enMap = en[mapIndex];
    const ruMap = ru[mapIndex];
    if (!ruMap) continue;
    const weekEn = enMap.weeks?.find((w) => w.code === code);
    const weekRu = ruMap.weeks?.find((w) => w.code === code);
    if (weekEn && weekRu) {
      return { mapIndex, enMap, ruMap, weekEn, weekRu };
    }
  }
  return null;
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

export { createEmptyWaves };
