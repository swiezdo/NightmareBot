/** Всего игровых волн в JSON (wave_1 … wave_N) */
export const TOTAL_WAVES = 15;
/** Слотов на волну (вторая цифра на кнопке W.s) */
export const SLOTS_PER_WAVE = 3;

/** Волн на странице: 3 ряда × 3 кнопки (одна волна = один ряд) */
export const WAVES_PER_PAGE = 3;
/** Число страниц пагинации */
export const GRID_PAGE_COUNT = Math.ceil(TOTAL_WAVES / WAVES_PER_PAGE);

/** @deprecated используйте WAVES_PER_PAGE */
export const WAVE_GROUPS = WAVES_PER_PAGE;
/** @deprecated используйте SLOTS_PER_WAVE */
export const SLOTS_PER_GROUP = SLOTS_PER_WAVE;
