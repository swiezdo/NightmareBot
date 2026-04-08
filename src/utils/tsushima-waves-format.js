import { EmbedBuilder } from 'discord.js';
import { loadRotations, findWeekContext, translateZoneSpawn } from '../data/rotation.js';
import { TOTAL_WAVES } from '../wizard/constants.js';

const WAVES_PER_EMBED = 3;
const EMBED_GROUP_COUNT = Math.ceil(TOTAL_WAVES / WAVES_PER_EMBED);
const EMBED_COLOR = 0x5865f2;
/** Отступ для 2-й и 3-й ячейки волны (под первой строкой с номером). */
const WAVE_SLOT_INDENT = '   ';
/** Разделитель между волнами в описании эмбеда (с переводами строк). */
const WAVE_BLOCK_SEPARATOR = `\n${'\u2500'.repeat(18)}\n`;

/**
 * @param {number} indexZeroBased
 */
function waveLinePrefix(indexZeroBased) {
  return `${indexZeroBased + 1}.`;
}

/** Жирный текст для каждой 3-й волны (3, 6, 9, 12, 15) в Discord markdown. */
function wrapThirdWaveBold(waveNum, line) {
  return waveNum > 0 && waveNum % 3 === 0 ? `**${line}**` : line;
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
 * @param {unknown} wavesRaw
 * @returns {Array<{ wave: number, spawns: ReturnType<typeof normalizeWaveSpawns> }>}
 */
function normalizeWavesRows(wavesRaw) {
  const waves = Array.isArray(wavesRaw) ? wavesRaw : [];
  return waves
    .map((w, idx) => {
      if (!w || typeof w !== 'object') return null;
      const o = /** @type {Record<string, unknown>} */ (w);
      const waveNum = Number(o.wave ?? idx + 1);
      const spawns = normalizeWaveSpawns(o.spawns);
      return { wave: Number.isFinite(waveNum) ? waveNum : idx + 1, spawns };
    })
    .filter(Boolean)
    .sort((a, b) => a.wave - b.wave);
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {string} zone
 * @param {string} spawn
 */
function formatSpawnLabel(ctx, locale, zone, spawn) {
  const zEn = String(zone ?? '').trim();
  const sEn = String(spawn ?? '').trim();

  if (!ctx) {
    if (!sEn) return zEn;
    if (zEn === sEn) return zEn;
    return `${zEn} ${sEn}`;
  }

  const { enMap, ruMap } = ctx;
  if (locale === 'ru') {
    const tr = translateZoneSpawn(enMap, ruMap, zEn, sEn);
    const z = String(tr.zone ?? '').trim();
    const s = String(tr.spawn ?? '').trim();
    if (!s) return z;
    if (z === s) return z;
    return `${z} ${s}`;
  }

  if (!sEn) return zEn;
  if (zEn === sEn) return zEn;
  return `${zEn} ${sEn}`;
}

/**
 * Один блок волны: первая ячейка с номером, остальные с отступом на новых строках.
 *
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {number} waveNum 1-based
 * @param {{ spawns: ReturnType<typeof normalizeWaveSpawns> }} row
 */
function formatOneWaveLine(ctx, locale, waveNum, row) {
  const idx = waveNum - 1;
  const spawns = row.spawns;
  if (spawns.length === 0) {
    return wrapThirdWaveBold(
      waveNum,
      `${waveLinePrefix(idx)} ${locale === 'ru' ? '_(нет спавнов)_' : '_(no spawns)_'}`,
    );
  }
  const parts = spawns.map(({ zone, spawn }) => formatSpawnLabel(ctx, locale, zone, spawn));
  const first = `${waveLinePrefix(idx)} ${parts[0]}`;
  const rest = parts
    .slice(1)
    .map((p) => `${WAVE_SLOT_INDENT}${p}`)
    .join('\n');
  const block = rest ? `${first}\n${rest}` : first;
  return wrapThirdWaveBold(waveNum, block);
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {unknown} wavesRaw
 * @returns {string[]}
 */
function buildFifteenWaveLines(ctx, locale, wavesRaw) {
  const normalized = normalizeWavesRows(wavesRaw);
  /** @type {Map<number, { spawns: ReturnType<typeof normalizeWaveSpawns> }>} */
  const byWave = new Map();
  for (const row of normalized) {
    if (row.wave >= 1 && row.wave <= TOTAL_WAVES) {
      byWave.set(row.wave, { spawns: row.spawns });
    }
  }

  /** @type {string[]} */
  const lines = [];
  for (let w = 1; w <= TOTAL_WAVES; w += 1) {
    const row = byWave.get(w);
    if (row) {
      lines.push(formatOneWaveLine(ctx, locale, w, row));
    } else {
      lines.push(
        wrapThirdWaveBold(
          w,
          `${waveLinePrefix(w - 1)} ${locale === 'ru' ? '_(нет данных)_' : '_(no data)_'}`,
        ),
      );
    }
  }
  return lines;
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {string} weekCode
 * @param {string} missingCtxNote
 */
function buildMainContent(ctx, locale, weekCode, missingCtxNote) {
  const wc = String(weekCode ?? '').trim() || '?';
  const lines = [];

  if (locale === 'ru') {
    lines.push(`# Неделя ${wc}`);
  } else {
    lines.push(`# Week ${wc}`);
  }

  if (ctx) {
    const map = locale === 'ru' ? ctx.ruMap : ctx.enMap;
    const week = locale === 'ru' ? ctx.weekRu : ctx.weekEn;
    const mapName = String(map?.name ?? '').trim();
    if (mapName) {
      lines.push(`## ${mapName}`);
    }
    const mod1 = String(week?.mod1 ?? '').trim();
    const mod2 = String(week?.mod2 ?? '').trim();
    const mod1Icon = String(week?.mod1_icon ?? '').trim();
    const mod2Icon = String(week?.mod2_icon ?? '').trim();
    if (mod1) lines.push(`> ${mod1}${mod1Icon ? ` ${mod1Icon}` : ''}`);
    if (mod2) lines.push(`> ${mod2}${mod2Icon ? ` ${mod2Icon}` : ''}`);
  } else {
    lines.push(missingCtxNote);
  }

  return lines.join('\n');
}

/** Лимит текста footer в Discord. */
const EMBED_FOOTER_TEXT_MAX = 2048;

/**
 * Кастомный эмодзи Discord → URL на CDN для embed thumbnail/image.
 *
 * @param {unknown} raw `<:name:id>` или `<a:name:id>`
 * @returns {string | null}
 */
function discordCustomEmojiToCdnUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const animated = s.match(/^<a:([^:]+):(\d+)>$/);
  if (animated) {
    return `https://cdn.discordapp.com/emojis/${animated[2]}.gif`;
  }
  const stat = s.match(/^<:([^:]+):(\d+)>$/);
  if (stat) {
    return `https://cdn.discordapp.com/emojis/${stat[2]}.png`;
  }
  return null;
}

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {unknown} wavesRaw
 * @param {string} [creditFooter]
 * @returns {EmbedBuilder[]}
 */
function buildWaveEmbedGroups(ctx, locale, wavesRaw, creditFooter) {
  const fifteen = buildFifteenWaveLines(ctx, locale, wavesRaw);
  const map = ctx != null ? (locale === 'ru' ? ctx.ruMap : ctx.enMap) : null;
  const objectives =
    map?.objectives && typeof map.objectives === 'object' ? map.objectives : null;

  /** @type {EmbedBuilder[]} */
  const embeds = [];
  for (let g = 0; g < EMBED_GROUP_COUNT; g += 1) {
    const slice = fifteen.slice(g * WAVES_PER_EMBED, (g + 1) * WAVES_PER_EMBED);
    const description = slice.join(WAVE_BLOCK_SEPARATOR).slice(0, 4096);
    const iconKey = `objective${g + 1}_icon`;
    const iconRaw = objectives ? /** @type {Record<string, unknown>} */ (objectives)[iconKey] : undefined;
    const thumbUrl = discordCustomEmojiToCdnUrl(iconRaw);

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setDescription(description || '—');
    if (thumbUrl) embed.setThumbnail(thumbUrl);
    embeds.push(embed);
  }

  const credit = String(creditFooter ?? '').trim();
  if (credit && embeds.length > 0) {
    const footerText =
      credit.length > EMBED_FOOTER_TEXT_MAX
        ? `${credit.slice(0, EMBED_FOOTER_TEXT_MAX - 1)}…`
        : credit;
    embeds[embeds.length - 1].setFooter({ text: footerText });
  }

  return embeds;
}

/**
 * @param {unknown} apiJson — тело GET /api/rotation/tsushima
 * @param {{ locale?: 'en' | 'ru' }} [options]
 * @returns {Array<{ content: string, embeds: EmbedBuilder[] }>}
 */
export function formatTsushimaRotationEmbedPayloads(apiJson, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'ru';
  const { en, ru } = loadRotations();
  const missingCtxNote =
    locale === 'ru'
      ? '⚠️ Неделя не найдена в `json/rotation_tsushima_*.json` — обновите файлы или проверьте `week_code`.'
      : '⚠️ Week not found in `json/rotation_tsushima_*.json` — refresh files or check `week_code`.';

  if (!apiJson || typeof apiJson !== 'object') {
    return [{ content: locale === 'ru' ? 'Пустой ответ API.' : 'Empty API response.', embeds: [] }];
  }

  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return [
      {
        content:
          locale === 'ru'
            ? 'На сайте нет ротации Tsushima на текущую неделю (`maps` пустой).'
            : 'No Tsushima rotation for the current site week (empty `maps`).',
        embeds: [],
      },
    ];
  }

  /** @type {Array<{ content: string, embeds: EmbedBuilder[] }>} */
  const out = [];
  for (const m of maps) {
    if (!m || typeof m !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (m);
    const weekCode = String(row.week_code ?? '').trim();
    const waves = row.waves;
    const creditText =
      row.credit_text != null && typeof row.credit_text === 'string'
        ? row.credit_text
        : row.credit_text != null
          ? String(row.credit_text)
          : '';
    const ctx = weekCode ? findWeekContext(en, ru, weekCode) : null;
    const content = buildMainContent(ctx, locale, weekCode, missingCtxNote);
    const embeds = buildWaveEmbedGroups(ctx, locale, waves, creditText);
    const contentTrimmed = content.length > 2000 ? `${content.slice(0, 1998)}…` : content;
    out.push({ content: contentTrimmed, embeds });
  }

  if (out.length === 0) {
    return [
      {
        content: locale === 'ru' ? 'Нет ни одной карты в ответе.' : 'No maps in response.',
        embeds: [],
      },
    ];
  }
  return out;
}
