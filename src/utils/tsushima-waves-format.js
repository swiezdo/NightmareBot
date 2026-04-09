import { EmbedBuilder } from 'discord.js';
import { loadRotations, findWeekContext, translateZoneSpawn } from '../data/rotation.js';
import { t } from '../i18n/strings.js';
import { TOTAL_WAVES } from '../wizard/constants.js';

const WAVES_PER_EMBED = 3;
const EMBED_GROUP_COUNT = Math.ceil(TOTAL_WAVES / WAVES_PER_EMBED);
const EMBED_COLOR = 0x5865f2;
/** Отступ для 2-й и 3-й ячейки волны (под первой строкой с номером). */
const WAVE_SLOT_INDENT = '    ';
/** Разделитель между волнами в описании эмбеда (с переводами строк). */
const WAVE_BLOCK_SEPARATOR = `\n${'\u2500'.repeat(16)}\n`;

/** Доп. отступ для 2-й и далее строк при двузначном номере (шире «N.»). У 11-й — на 1 пробел меньше. */
const WIDE_WAVE_CONT_EXTRA = '   ';

function waveContinuationExtraIndent(waveNum) {
  if (waveNum < 10) return '';
  if (waveNum === 11) return WIDE_WAVE_CONT_EXTRA.slice(1);
  return WIDE_WAVE_CONT_EXTRA;
}

/** +1 пробел к отступу продолжений: однозначные 2–6 и 8–9 (не 1 и не 7 — визуально совпадают с базовым отступом). */
function singleDigitWaveContinuationPad(waveNum) {
  if (waveNum < 2 || waveNum > 9) return '';
  if (waveNum === 7) return '';
  return ' ';
}

/** Номер волны в Discord markdown (жирный): `**1.**` */
function boldWavePrefix(waveNum) {
  return `**${waveNum}.**`;
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
  const spawns = row.spawns;
  if (spawns.length === 0) {
    return `${boldWavePrefix(waveNum)} ${t(locale, 'tsushima_wave_no_spawns')}`;
  }
  const parts = spawns.map(({ zone, spawn }) => formatSpawnLabel(ctx, locale, zone, spawn));
  const contExtra = `${singleDigitWaveContinuationPad(waveNum)}${waveContinuationExtraIndent(waveNum)}`;
  const first = `${boldWavePrefix(waveNum)} ${parts[0]}`;
  const rest = parts
    .slice(1)
    .map((p) => `${WAVE_SLOT_INDENT}${contExtra}${p}`)
    .join('\n');
  return rest ? `${first}\n${rest}` : first;
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
      lines.push(`${boldWavePrefix(w)} ${t(locale, 'tsushima_wave_no_data')}`);
    }
  }
  return lines;
}

/** Лимит текста сообщения Discord (content). */
const MESSAGE_CONTENT_MAX = 2000;

/**
 * @param {object|null} ctx
 * @param {'en' | 'ru'} locale
 * @param {string} weekCode
 * @param {string} missingCtxNote
 * @param {string} [creditText]
 */
function buildMainContent(ctx, locale, weekCode, missingCtxNote, creditText) {
  const wc = String(weekCode ?? '').trim() || '?';
  const lines = [];

  lines.push(`# ${t(locale, 'week_code_label').replace('{code}', wc)}`);

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

  const body = lines.join('\n');
  const credit = String(creditText ?? '').trim();
  if (ctx && credit) {
    let creditLine = `*${credit}*`;
    if (creditLine.length > MESSAGE_CONTENT_MAX) {
      const innerMax = MESSAGE_CONTENT_MAX - 3;
      creditLine = `*${credit.slice(0, Math.max(0, innerMax - 1))}…*`;
    }
    const sepLen = 2;
    const maxBody = MESSAGE_CONTENT_MAX - sepLen - creditLine.length;
    if (maxBody < 0) {
      return creditLine.slice(0, MESSAGE_CONTENT_MAX);
    }
    const trimmedBody =
      body.length > maxBody ? `${body.slice(0, Math.max(0, maxBody - 1))}…` : body;
    return `${trimmedBody}\n\n${creditLine}`;
  }

  return body.length > MESSAGE_CONTENT_MAX
    ? `${body.slice(0, MESSAGE_CONTENT_MAX - 1)}…`
    : body;
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
 * @returns {EmbedBuilder[]}
 */
function buildWaveEmbedGroups(ctx, locale, wavesRaw) {
  const fifteen = buildFifteenWaveLines(ctx, locale, wavesRaw);
  const map = ctx != null ? (locale === 'ru' ? ctx.ruMap : ctx.enMap) : null;
  const objectives =
    map?.objectives && typeof map.objectives === 'object' ? map.objectives : null;
  const modsBlock =
    map?.mods && typeof map.mods === 'object' ? /** @type {Record<string, unknown>} */ (map.mods) : null;

  /** @type {EmbedBuilder[]} */
  const embeds = [];
  for (let g = 0; g < EMBED_GROUP_COUNT; g += 1) {
    const slice = fifteen.slice(g * WAVES_PER_EMBED, (g + 1) * WAVES_PER_EMBED);
    const description = slice.join(WAVE_BLOCK_SEPARATOR).slice(0, 4096);
    const iconKey = `objective${g + 1}_icon`;
    const iconRaw = objectives ? /** @type {Record<string, unknown>} */ (objectives)[iconKey] : undefined;
    const thumbUrl = discordCustomEmojiToCdnUrl(iconRaw);

    const seg = g + 1;
    const mapModName = modsBlock ? String(modsBlock[`mod${seg}`] ?? '').trim() : '';
    const mapModIconRaw = modsBlock ? String(modsBlock[`mod${seg}_icon`] ?? '').trim() : '';
    const segmentFooterIconUrl = discordCustomEmojiToCdnUrl(mapModIconRaw);

    const footerWave = seg * WAVES_PER_EMBED;
    const waveLabel = t(locale, 'tsushima_footer_wave').replace('{wave}', String(footerWave));
    let footerText = mapModName ? `${waveLabel} — ${mapModName}` : waveLabel;
    if (footerText.length > EMBED_FOOTER_TEXT_MAX) {
      footerText = `${footerText.slice(0, EMBED_FOOTER_TEXT_MAX - 1)}…`;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setDescription(description || '—');
    if (thumbUrl) embed.setThumbnail(thumbUrl);
    /** @type {{ text: string, iconURL?: string }} */
    const footerOpts = { text: footerText };
    if (segmentFooterIconUrl) footerOpts.iconURL = segmentFooterIconUrl;
    embed.setFooter(footerOpts);
    embeds.push(embed);
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
  const missingCtxNote = t(locale, 'tsushima_format_missing_week_json');

  if (!apiJson || typeof apiJson !== 'object') {
    return [{ content: t(locale, 'tsushima_format_empty_api'), embeds: [] }];
  }

  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return [{ content: t(locale, 'tsushima_format_empty_maps'), embeds: [] }];
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
    const content = buildMainContent(ctx, locale, weekCode, missingCtxNote, creditText);
    const embeds = buildWaveEmbedGroups(ctx, locale, waves);
    out.push({ content, embeds });
  }

  if (out.length === 0) {
    return [{ content: t(locale, 'tsushima_format_no_maps_in_response'), embeds: [] }];
  }
  return out;
}
