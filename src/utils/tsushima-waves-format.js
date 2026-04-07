import { loadRotations, findWeekContext, translateZoneSpawn } from '../data/rotation.js';

/** Запас под лимит Discord 2000. */
const DISCORD_CHUNK_MAX = 1900;

const KEYCAP_PREFIXES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/**
 * @param {number} indexZeroBased
 */
function waveLinePrefix(indexZeroBased) {
  const n = indexZeroBased + 1;
  if (n >= 1 && n <= KEYCAP_PREFIXES.length) return KEYCAP_PREFIXES[n - 1];
  return `${n}.`;
}

/**
 * @param {import('../data/rotation.js').RotationMap} map
 */
function formatObjectivesLines(map) {
  const o = map?.objectives;
  if (!o || typeof o !== 'object') return '';
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const text = o[`objective${i}`];
    const num = o[`objective${i}_num`];
    if (text != null && String(text).trim() && num != null && Number(num) > 0) {
      lines.push(`• **${num}**× ${String(text).trim()}`);
    }
  }
  return lines.join('\n');
}

/**
 * @param {unknown} spawnsRaw
 * @returns {Array<{ order: number, zone: string, spawn: string }>}
 */
export function normalizeWaveSpawns(spawnsRaw) {
  if (!Array.isArray(spawnsRaw)) return [];
  return spawnsRaw
    .map((s, i) => {
      if (!s || typeof s !== 'object') return null;
      const o = /** @type {Record<string, unknown>} */ (s);
      const order = Number(o.order ?? i + 1);
      const zone = String(o.zone ?? '').trim();
      const spawn = String(o.spawn ?? '').trim();
      return { order: Number.isFinite(order) ? order : i + 1, zone, spawn };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

/**
 * @param {object} ctx — findWeekContext result
 * @param {'en' | 'ru'} locale
 * @param {unknown} wavesRaw
 * @param {string} weekCode
 */
function formatWavesSection(ctx, locale, wavesRaw, weekCode) {
  const waves = Array.isArray(wavesRaw) ? wavesRaw : [];
  /** @type {Array<{ wave: number, spawns: ReturnType<typeof normalizeWaveSpawns> }>} */
  const normalized = waves
    .map((w, idx) => {
      if (!w || typeof w !== 'object') return null;
      const o = /** @type {Record<string, unknown>} */ (w);
      const waveNum = Number(o.wave ?? idx + 1);
      const spawns = normalizeWaveSpawns(o.spawns);
      return { wave: Number.isFinite(waveNum) ? waveNum : idx + 1, spawns };
    })
    .filter(Boolean);

  const lines = [];
  let waveIdx = 0;
  for (const row of normalized) {
    const spawns = row.spawns;
    if (spawns.length === 0) {
      lines.push(`${waveLinePrefix(waveIdx)} _(нет спавнов)_`);
      waveIdx += 1;
      continue;
    }
    const parts = spawns.map(({ zone, spawn }) => {
      if (!ctx) {
        return spawn ? `${zone} — ${spawn}` : zone;
      }
      const { enMap, ruMap } = ctx;
      if (locale === 'ru') {
        const t = translateZoneSpawn(enMap, ruMap, zone, spawn);
        return t.spawn ? `${t.zone} — ${t.spawn}` : t.zone;
      }
      return spawn ? `${zone} — ${spawn}` : zone;
    });
    lines.push(`${waveLinePrefix(waveIdx)} ${parts.join('; ')}`);
    waveIdx += 1;
  }

  if (lines.length === 0) {
    return locale === 'ru' ? '_(нет данных о волнах)_' : '_(no wave data)_';
  }
  return lines.join('\n');
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {string} weekCode
 * @param {unknown} wavesRaw
 * @param {string} missingCtxNote
 */
function formatOneMapBlock(ctx, locale, weekCode, wavesRaw, missingCtxNote) {
  const wc = String(weekCode ?? '').trim() || '?';
  const headerWeek =
    locale === 'ru' ? `**Неделя:** ${wc}` : `**Week:** ${wc}`;

  let meta = '';
  if (ctx) {
    const map = locale === 'ru' ? ctx.ruMap : ctx.enMap;
    const week = locale === 'ru' ? ctx.weekRu : ctx.weekEn;
    const mapName = map?.name ?? '';
    const modsLabel = locale === 'ru' ? '**Модификаторы недели:**' : '**Week modifiers:**';
    const bonusLabel = locale === 'ru' ? '**Бонусные задачи:**' : '**Bonus objectives:**';
    const mod1 = week?.mod1 ?? '';
    const mod2 = week?.mod2 ?? '';
    const obj = formatObjectivesLines(map);
    const wavesHdr = locale === 'ru' ? '**Волны:**' : '**Waves:**';
    meta = [
      headerWeek,
      mapName ? (locale === 'ru' ? `**Карта:** ${mapName}` : `**Map:** ${mapName}`) : '',
      mod1 || mod2 ? `${modsLabel} ${[mod1, mod2].filter(Boolean).join(' · ')}` : '',
      obj ? `${bonusLabel}\n${obj}` : '',
      wavesHdr,
      formatWavesSection(ctx, locale, wavesRaw, wc),
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    const wavesHdr = locale === 'ru' ? '**Волны:**' : '**Waves:**';
    meta = [headerWeek, missingCtxNote, wavesHdr, formatWavesSection(null, locale, wavesRaw, wc)]
      .filter(Boolean)
      .join('\n');
  }

  return meta;
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
function chunkByLength(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {string} weekCode
 * @param {unknown} wavesRaw
 * @param {string} missingCtxNote
 */
function formatOneMapChunked(ctx, locale, weekCode, wavesRaw, missingCtxNote) {
  const full = formatOneMapBlock(ctx, locale, weekCode, wavesRaw, missingCtxNote);
  if (full.length <= DISCORD_CHUNK_MAX) return [full];
  return chunkByLength(full, DISCORD_CHUNK_MAX);
}

/**
 * @param {unknown} apiJson — тело GET /api/rotation/tsushima
 * @param {{ locale?: 'en' | 'ru' }} [options]
 * @returns {string[]}
 */
export function formatTsushimaRotationChunks(apiJson, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'ru';
  const { en, ru } = loadRotations();
  const missingCtxNote =
    locale === 'ru'
      ? '⚠️ Неделя не найдена в `json/rotation_tsushima_*.json` — обновите файлы или проверьте `week_code`.'
      : '⚠️ Week not found in `json/rotation_tsushima_*.json` — refresh files or check `week_code`.';

  if (!apiJson || typeof apiJson !== 'object') {
    return [locale === 'ru' ? 'Пустой ответ API.' : 'Empty API response.'];
  }

  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return [locale === 'ru' ? 'На сайте нет ротации Tsushima на текущую неделю (`maps` пустой).' : 'No Tsushima rotation for the current site week (empty `maps`).'];
  }

  /** @type {string[]} */
  const out = [];
  for (const m of maps) {
    if (!m || typeof m !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (m);
    const weekCode = String(row.week_code ?? '').trim();
    const waves = row.waves;
    const ctx = weekCode ? findWeekContext(en, ru, weekCode) : null;
    const blocks = formatOneMapChunked(ctx, locale, weekCode, waves, missingCtxNote);
    for (const b of blocks) out.push(b);
  }

  if (out.length === 0) {
    return [locale === 'ru' ? 'Нет ни одной карты в ответе.' : 'No maps in response.'];
  }
  return out;
}

export { DISCORD_CHUNK_MAX };
