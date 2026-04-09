import { EmbedBuilder } from 'discord.js';
import { t } from '../i18n/strings.js';
import {
  WAVE_BLOCK_SEPARATOR,
  formatWaveBlockFromCellLines,
  finalizeDiscordMessageContent,
} from './wave-embed-lines.js';

const EMBED_COLOR = 0x5865f2;
const STAGE_COUNT = 4;

/**
 * @param {unknown} spawn
 * @param {'en' | 'ru'} locale
 * @returns {string}
 */
function yoteiSpawnCellLine(spawn, locale) {
  if (!spawn || typeof spawn !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (spawn);
  const loc = String(o.location ?? '').trim();
  if (!loc) return '';
  const pt = o.spawn_point != null ? String(o.spawn_point).trim() : '';
  const att = Array.isArray(o.attunements)
    ? o.attunements.map((x) => String(x).trim()).filter(Boolean)
    : [];
  let line = pt ? `${loc} — ${pt}` : loc;
  if (att.length > 0) {
    const tag = locale === 'ru' ? 'настройки' : 'attunements';
    line += ` (${tag}: ${att.join(', ')})`;
  }
  return line;
}

/**
 * @param {unknown} round
 * @returns {string}
 */
function challengeCardFromRound(round) {
  if (!round || typeof round !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (round);
  const direct = o.challenge_card ?? o.challengeCard;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (direct && typeof direct === 'object') {
    const nm = String(/** @type {Record<string, unknown>} */ (direct).name ?? '').trim();
    if (nm) return nm;
  }
  const ch = o.challenge;
  if (ch && typeof ch === 'object') {
    const nm = String(/** @type {Record<string, unknown>} */ (ch).name ?? '').trim();
    if (nm) return nm;
  }
  return '';
}

/**
 * @param {unknown} r
 * @returns {number | null}
 */
function roundNumber(r) {
  if (!r || typeof r !== 'object') return null;
  const n = Number(/** @type {Record<string, unknown>} */ (r).round);
  return Number.isFinite(n) ? n : null;
}

/**
 * Слоты 1–4 по полю `round`.
 *
 * @param {unknown} roundsRaw
 * @returns {(object | null)[]}
 */
function roundsFourSlots(roundsRaw) {
  /** @type {(object | null)[]} */
  const slots = [null, null, null, null];
  const rounds = Array.isArray(roundsRaw) ? roundsRaw : [];
  for (const r of rounds) {
    if (!r || typeof r !== 'object') continue;
    const n = roundNumber(r);
    if (n != null && n >= 1 && n <= STAGE_COUNT) slots[n - 1] = r;
  }
  return slots;
}

/**
 * @param {object} round
 * @param {'en' | 'ru'} locale
 * @returns {string[]}
 */
function waveLineBlocksForRound(round, locale) {
  const ro = /** @type {Record<string, unknown>} */ (round);
  const waves = Array.isArray(ro.waves) ? [...ro.waves] : [];
  const sorted = waves
    .filter((w) => w && typeof w === 'object')
    .sort((a, b) => {
      const wa = Number(/** @type {Record<string, unknown>} */ (a).wave);
      const wb = Number(/** @type {Record<string, unknown>} */ (b).wave);
      const na = Number.isFinite(wa) ? wa : 0;
      const nb = Number.isFinite(wb) ? wb : 0;
      return na - nb;
    });

  /** @type {string[]} */
  const blocks = [];
  let display = 1;
  for (const w of sorted) {
    const wo = /** @type {Record<string, unknown>} */ (w);
    const spawns = Array.isArray(wo.spawns) ? [...wo.spawns] : [];
    spawns.sort((a, b) => {
      const oa = a && typeof a === 'object' && /** @type {{ order?: number }} */ (a).order;
      const ob = b && typeof b === 'object' && /** @type {{ order?: number }} */ (b).order;
      return (typeof oa === 'number' ? oa : 0) - (typeof ob === 'number' ? ob : 0);
    });
    const cellLines = spawns.map((s) => yoteiSpawnCellLine(s, locale)).filter(Boolean);
    blocks.push(
      formatWaveBlockFromCellLines(display, cellLines, t(locale, 'tsushima_wave_no_spawns')),
    );
    display += 1;
  }
  return blocks;
}

/**
 * @param {Record<string, unknown>} mapRow
 * @param {'en' | 'ru'} locale
 * @param {string} creditText
 */
function buildYoteiMainContent(mapRow, locale, creditText) {
  const name = String(mapRow.name ?? '').trim() || '?';
  const lines = [
    `# ${name}`,
    `## ${t(locale, 'yotei_challenge_cards_header')}`,
  ];

  const slots = roundsFourSlots(mapRow.rounds);
  const dash = t(locale, 'yotei_stage_no_data');
  for (let i = 0; i < STAGE_COUNT; i += 1) {
    const card = slots[i] ? challengeCardFromRound(slots[i]) : '';
    lines.push(`> ${i + 1}. ${card || dash}`);
  }

  return finalizeDiscordMessageContent(lines.join('\n'), creditText);
}

/**
 * @param {unknown} apiJson
 * @param {{ locale?: 'en' | 'ru' }} [options]
 * @returns {Array<{ content: string, embeds: EmbedBuilder[] }>}
 */
export function formatYoteiRotationEmbedPayloads(apiJson, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'ru';

  if (!apiJson || typeof apiJson !== 'object') {
    return [{ content: t(locale, 'yotei_format_empty_api'), embeds: [] }];
  }

  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return [{ content: t(locale, 'yotei_format_empty_maps'), embeds: [] }];
  }

  /** @type {Array<{ content: string, embeds: EmbedBuilder[] }>} */
  const out = [];

  for (const mapRow of maps) {
    if (!mapRow || typeof mapRow !== 'object') continue;
    const m = /** @type {Record<string, unknown>} */ (mapRow);
    const creditText =
      m.credit_text != null && typeof m.credit_text === 'string'
        ? m.credit_text
        : m.credit_text != null
          ? String(m.credit_text)
          : '';

    const content = buildYoteiMainContent(m, locale, creditText);
    const slots = roundsFourSlots(m.rounds);

    /** @type {EmbedBuilder[]} */
    const embeds = [];
    for (let stage = 1; stage <= STAGE_COUNT; stage += 1) {
      const round = slots[stage - 1];
      const title = t(locale, 'yotei_stage_title').replace('{n}', String(stage));

      let description = t(locale, 'yotei_stage_no_data');
      if (round && typeof round === 'object') {
        const blocks = waveLineBlocksForRound(round, locale);
        description = blocks.length > 0 ? blocks.join(WAVE_BLOCK_SEPARATOR) : t(locale, 'yotei_stage_no_data');
      }

      embeds.push(
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle(title)
          .setDescription(description.slice(0, 4096) || '—'),
      );
    }

    out.push({ content, embeds });
  }

  if (out.length === 0) {
    return [{ content: t(locale, 'yotei_format_no_maps_in_response'), embeds: [] }];
  }

  return out;
}
