/** @typedef {'tsushima' | 'yotei'} WizardGame */

/**
 * @typedef {{
 *   game: WizardGame,
 *   totalWaves: number,
 *   wavesPerPage: number,
 *   gridPageCount: number,
 *   slotsForWave: (waveNum: number) => number,
 * }} WaveGridSpec
 */

/**
 * @param {WizardGame} [game]
 * @returns {WaveGridSpec}
 */
export function getWaveGridSpec(game = 'tsushima') {
  if (game === 'yotei') {
    const totalWaves = 12;
    const wavesPerPage = 3;
    return {
      game: 'yotei',
      totalWaves,
      wavesPerPage,
      gridPageCount: Math.ceil(totalWaves / wavesPerPage),
      slotsForWave: (waveNum) => (waveNum <= 9 ? 3 : 4),
    };
  }
  const totalWaves = 15;
  const wavesPerPage = 3;
  return {
    game: 'tsushima',
    totalWaves,
    wavesPerPage,
    gridPageCount: Math.ceil(totalWaves / wavesPerPage),
    slotsForWave: () => 3,
  };
}
