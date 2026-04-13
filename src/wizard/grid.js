import { getWaveGridSpec } from './game-geometry.js';

/**
 * Button W.s maps to waves.wave_W["s"]; slot count depends on game (Yōtei: 3 or 4 per wave).
 *
 * @param {import('./game-geometry.js').WizardGame} [game]
 */
export function isCellFilled(draft, waveNum, slotNum, game = 'tsushima') {
  const cell = draft.waves[`wave_${waveNum}`]?.[`${slotNum}`];
  return Boolean(cell?.zone_en);
}

/**
 * @param {object} draft
 * @param {import('./game-geometry.js').WizardGame} [game]
 */
export function isGridComplete(draft, game = 'tsushima') {
  const spec = getWaveGridSpec(game);
  for (let w = 1; w <= spec.totalWaves; w++) {
    const slots = spec.slotsForWave(w);
    for (let s = 1; s <= slots; s++) {
      if (!isCellFilled(draft, w, s, game)) return false;
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
/**
 * @param {object} draft
 * @param {number} waveNum
 * @param {number} slotNum
 * @param {{ zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string, attunements?: string[] }} zoneSpawn
 */
export function setWaveCell(
  draft,
  waveNum,
  slotNum,
  { zoneEn, zoneRu, spawnEn, spawnRu, attunements = [] },
) {
  const w = draft.waves[`wave_${waveNum}`];
  if (!w) return;
  w[`${slotNum}`] = {
    zone_en: zoneEn,
    zone_ru: zoneRu,
    spawn_en: spawnEn,
    spawn_ru: spawnRu,
    attunements: Array.isArray(attunements)
      ? attunements.map((x) => String(x).trim()).filter(Boolean)
      : [],
  };
}
