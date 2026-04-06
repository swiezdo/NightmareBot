import { SLOTS_PER_WAVE, TOTAL_WAVES } from './constants.js';

/**
 * Button W.s maps to waves.wave_W["s"], W = 1…TOTAL_WAVES, s = 1…3.
 */

/**
 * @param {object} draft
 * @param {number} waveNum
 * @param {number} slotNum
 */
export function isCellFilled(draft, waveNum, slotNum) {
  const cell = draft.waves[`wave_${waveNum}`]?.[`${slotNum}`];
  return Boolean(cell?.zone_en);
}

export function isGridComplete(draft) {
  for (let w = 1; w <= TOTAL_WAVES; w++) {
    for (let s = 1; s <= SLOTS_PER_WAVE; s++) {
      if (!isCellFilled(draft, w, s)) return false;
    }
  }
  return true;
}

/**
 * @param {object} draft
 * @param {number} waveNum
 * @param {number} slotNum
 * @param {object} zoneSpawn
 */
export function setWaveCell(draft, waveNum, slotNum, { zoneEn, zoneRu, spawnEn, spawnRu }) {
  const w = draft.waves[`wave_${waveNum}`];
  if (!w) return;
  w[`${slotNum}`] = {
    zone_en: zoneEn,
    zone_ru: zoneRu,
    spawn_en: spawnEn,
    spawn_ru: spawnRu,
  };
}
