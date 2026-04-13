import { EmbedBuilder } from 'discord.js';
import {
  loadYoteiLabels,
  resolveYoteiChallengeCard,
  resolveYoteiChallengeCardThumbnail,
  resolveYoteiMapTitle,
  resolveYoteiZone,
} from '../data/yotei-labels.js';
import {
  getYoteiMapZoneRows,
  labelForYoteiSpawnSlug,
  resolveYoteiSpawnPointSlug,
  toYoteiLocationApiSlug,
} from '../data/yotei-map-zones.js';
import { normalizeYoteiApiJsonForEmbeds } from '../api/nightmare-yotei.js';
import { t } from '../i18n/strings.js';
import {
  WAVE_BLOCK_SEPARATOR,
  formatWaveBlockFromCellLines,
  finalizeDiscordMessageContent,
} from './wave-embed-lines.js';

const EMBED_COLOR = 0x5865f2;
const STAGE_COUNT = 4;
const ATTUNEMENT_EMOJI = {
  Sun: '🟡',
  Moon: '🔵',
  Storm: '🟢',
};

/**
 * Ключ карты для словаря: Nightmare.Club отдаёт `slug`; опционально `map_slug`.
 *
 * @param {Record<string, unknown>} mapRow
 */
function mapDictionaryKey(mapRow) {
  return String(mapRow.map_slug ?? mapRow.slug ?? mapRow.name ?? '').trim();
}

/**
 * @param {unknown} spawn
 * @param {ReturnType<typeof import('../data/yotei-labels.js').loadYoteiLabels>} labels
 * @param {'en' | 'ru'} locale
 * @param {string} mapKey
 */
function yoteiSpawnCellLine(spawn, labels, locale, mapKey) {
  if (!spawn || typeof spawn !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (spawn);
  const loc = String(o.location ?? '').trim();
  if (!loc) return '';
  const line = resolveYoteiZone(labels, loc, locale, mapKey);

  const spawnRaw = String(o.spawn_point ?? o.spawn ?? '').trim();
  const rows = getYoteiMapZoneRows(mapKey);
  const row =
    rows.find((z) => z.location === loc) ??
    rows.find((z) => toYoteiLocationApiSlug(z.location) === toYoteiLocationApiSlug(loc));
  const locKey = row ? row.location : loc;
  const spawnSlug = resolveYoteiSpawnPointSlug(mapKey, locKey, spawnRaw);
  const spawnLabel = row && spawnSlug ? labelForYoteiSpawnSlug(row, spawnSlug, locale) : '';
  let out = line;
  if (spawnLabel) {
    out = `${line} ${spawnLabel}`.trim();
  }

  const att = Array.isArray(o.attunements)
    ? o.attunements.map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (att.length === 0) return out;
  const emoji = att.map((x) => ATTUNEMENT_EMOJI[x] ?? x).join('');
  return `${out} ${emoji}`.trim();
}

/**
 * Ключ для `challengeCards` в JSON + поля API для отображения (в шапке — `description`, не `name`).
 *
 * @param {unknown} round
 * @returns {{ key: string, description: string, name: string }}
 */
function challengeApiFieldsFromRound(round) {
  if (!round || typeof round !== 'object') {
    return { key: '', description: '', name: '' };
  }
  const o = /** @type {Record<string, unknown>} */ (round);
  let key = '';
  let description = '';
  let name = '';

  const direct = o.challenge_card ?? o.challengeCard;
  if (typeof direct === 'string' && direct.trim()) {
    key = direct.trim();
  } else if (direct && typeof direct === 'object') {
    const d = /** @type {Record<string, unknown>} */ (direct);
    name = String(d.name ?? '').trim();
    description = String(d.description ?? '').trim();
    if (name) key = name;
  }

  const ch = o.challenge;
  if (ch && typeof ch === 'object') {
    const c = /** @type {Record<string, unknown>} */ (ch);
    const cn = String(c.name ?? '').trim();
    const cd = String(c.description ?? '').trim();
    if (!name) name = cn;
    if (!description) description = cd;
    if (!key && cn) key = cn;
  }

  return { key, description, name };
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
 * @param {ReturnType<typeof import('../data/yotei-labels.js').loadYoteiLabels>} labels
 * @param {'en' | 'ru'} locale
 * @param {string} mapKey
 * @returns {string[]}
 */
function waveLineBlocksForRound(round, labels, locale, mapKey) {
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
    const cellLines = spawns.map((s) => yoteiSpawnCellLine(s, labels, locale, mapKey)).filter(Boolean);
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
 * @param {ReturnType<typeof import('../data/yotei-labels.js').loadYoteiLabels>} labels
 */
function buildYoteiMainContent(mapRow, locale, creditText, labels) {
  const mapKey = mapDictionaryKey(mapRow);
  const apiMapTitle = String(mapRow.name ?? mapRow.title ?? '').trim() || mapKey;
  const title = resolveYoteiMapTitle(labels, mapKey, locale, apiMapTitle);
  const lines = [`# ${title}`];
  return finalizeDiscordMessageContent(lines.join('\n'), creditText);
}

/**
 * @param {unknown} apiJson
 * @param {{ locale?: 'en' | 'ru' }} [options]
 * @returns {Array<{ content: string, embeds: EmbedBuilder[] }>}
 */
export function formatYoteiRotationEmbedPayloads(apiJson, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'ru';
  const labels = loadYoteiLabels();

  if (!apiJson || typeof apiJson !== 'object') {
    return [{ content: t(locale, 'yotei_format_empty_api'), embeds: [] }];
  }

  const wrapped = normalizeYoteiApiJsonForEmbeds(apiJson, labels);
  if (!wrapped || !Array.isArray(wrapped.maps) || wrapped.maps.length === 0) {
    return [{ content: t(locale, 'yotei_format_empty_maps'), embeds: [] }];
  }
  const maps = wrapped.maps;

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

    const content = buildYoteiMainContent(m, locale, creditText, labels);
    const mapKey = mapDictionaryKey(m);
    const slots = roundsFourSlots(m.rounds);

    /** @type {EmbedBuilder[]} */
    const embeds = [];
    for (let stage = 1; stage <= STAGE_COUNT; stage += 1) {
      const round = slots[stage - 1];
      const title = t(locale, 'yotei_stage_title').replace('{n}', String(stage));

      let description = t(locale, 'yotei_stage_no_data');
      if (round && typeof round === 'object') {
        const blocks = waveLineBlocksForRound(round, labels, locale, mapKey);
        description = blocks.length > 0 ? blocks.join(WAVE_BLOCK_SEPARATOR) : t(locale, 'yotei_stage_no_data');
      }

      const challengeFields =
        round && typeof round === 'object' ? challengeApiFieldsFromRound(round) : { key: '', description: '', name: '' };
      const { key: cardKey, description: chDesc, name: chName } = challengeFields;
      const apiCardLine = (chDesc || chName).trim();
      const cardLine =
        round && typeof round === 'object'
          ? resolveYoteiChallengeCard(labels, cardKey, locale, apiCardLine)
          : '';
      const cardThumbUrl = cardKey ? resolveYoteiChallengeCardThumbnail(labels, cardKey) : null;

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(title)
        .setDescription(description.slice(0, 4096) || '—');
      if (cardThumbUrl) embed.setThumbnail(cardThumbUrl);
      const footer = cardLine.trim() ? cardLine.trim().slice(0, 2048) : '';
      if (footer) embed.setFooter({ text: footer });
      embeds.push(embed);
    }

    out.push({ content, embeds });
  }

  if (out.length === 0) {
    return [{ content: t(locale, 'yotei_format_no_maps_in_response'), embeds: [] }];
  }

  return out;
}
