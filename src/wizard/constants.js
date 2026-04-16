/** Total game waves in JSON (wave_1 … wave_N). */
export const TOTAL_WAVES = 15;
/** Slots per wave (second digit on button W.s). */
export const SLOTS_PER_WAVE = 3;

/** Waves per page: 3 rows × 3 buttons (one wave = one row). */
export const WAVES_PER_PAGE = 3;
/** Number of pagination pages. */
export const GRID_PAGE_COUNT = Math.ceil(TOTAL_WAVES / WAVES_PER_PAGE);
