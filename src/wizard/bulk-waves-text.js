import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { findWeekContext, normalizeSpawns } from '../data/rotation.js';
import { t } from '../i18n/strings.js';
import { SLOTS_PER_WAVE, TOTAL_WAVES } from './constants.js';
import { setWaveCell } from './grid.js';
import { appendFlowSuffix } from './wave-custom-id.js';

const DISCORD_MAX = 2000;
const EMBED_DESC_MAX = 4096;

/**
 * @param {string} s
 */
export function normToken(s) {
  return String(s)
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * @param {string} s
 */
function escapeDiscordBoldSegment(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
}

/**
 * @typedef {{
 *   zoneEn: string,
 *   zoneRu: string,
 *   spawnEn: string,
 *   spawnRu: string,
 *   displayLine: string,
 *   keyNorms: string[],
 * }} SpawnCatalogEntry
 */

/**
 * @param {import('../data/rotation.js').RotationMap} enMap
 * @param {import('../data/rotation.js').RotationMap} ruMap
 * @param {'en' | 'ru'} locale
 * @returns {SpawnCatalogEntry[]}
 */
export function buildSpawnCatalog(enMap, ruMap, locale) {
  const zCount = Math.min(enMap.zones_spawns.length, ruMap.zones_spawns.length);
  /** @type {SpawnCatalogEntry[]} */
  const out = [];
  for (let i = 0; i < zCount; i++) {
    const spEn = normalizeSpawns(enMap.zones_spawns[i]?.spawns);
    const spRu = normalizeSpawns(ruMap.zones_spawns[i]?.spawns);
    const zoneEn = String(enMap.zones_spawns[i]?.zone ?? '');
    const zoneRu = String(ruMap.zones_spawns[i]?.zone ?? '');
    if (spEn.length <= 1) {
      const displayLine = locale === 'en' ? zoneEn : zoneRu;
      const keyNorms = Array.from(
        new Set([normToken(zoneEn), normToken(zoneRu)].filter(Boolean)),
      );
      out.push({
        zoneEn,
        zoneRu,
        spawnEn: spEn[0] ?? '',
        spawnRu: spRu[0] ?? '',
        displayLine,
        keyNorms,
      });
    } else {
      for (let j = 0; j < spEn.length; j++) {
        const se = spEn[j] ?? '';
        const sr = spRu[j] ?? se;
        const displayLine =
          locale === 'en' ? `${zoneEn} ${se}` : `${zoneRu} ${sr}`;
        const variants = [
          `${zoneEn} ${se}`,
          `${zoneRu} ${sr}`,
          `${zoneEn} ${sr}`,
          `${zoneRu} ${se}`,
        ];
        const keyNorms = Array.from(
          new Set(variants.map((x) => normToken(x)).filter(Boolean)),
        );
        out.push({
          zoneEn,
          zoneRu,
          spawnEn: se,
          spawnRu: sr,
          displayLine,
          keyNorms,
        });
      }
    }
  }
  return out;
}

/**
 * @param {SpawnCatalogEntry[]} catalog
 * @returns {{ key: string, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]}
 */
function buildSortedMatchers(catalog) {
  /** @type {{ key: string, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} */
  const all = [];
  for (const e of catalog) {
    for (const kn of e.keyNorms) {
      all.push({
        key: kn,
        zoneEn: e.zoneEn,
        zoneRu: e.zoneRu,
        spawnEn: e.spawnEn,
        spawnRu: e.spawnRu,
      });
    }
  }
  all.sort((a, b) => b.key.length - a.key.length);
  const seen = new Set();
  /** @type {typeof all} */
  const uniq = [];
  for (const m of all) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    uniq.push(m);
  }
  return uniq;
}

/**
 * Matchers from catalog plus zone-only keys (empty spawn) for multi-spawn zones.
 *
 * @param {SpawnCatalogEntry[]} catalog
 */
function buildSortedMatchersWithZoneOnly(catalog) {
  /** @type {Map<string, SpawnCatalogEntry[]>} */
  const byZone = new Map();
  for (const e of catalog) {
    const z = e.zoneEn;
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(e);
  }
  /** @type {{ key: string, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} */
  const extra = [];
  for (const entries of byZone.values()) {
    if (entries.length <= 1) continue;
    const e0 = entries[0];
    const zn = normToken(e0.zoneEn);
    const rn = normToken(e0.zoneRu);
    if (zn) {
      extra.push({
        key: zn,
        zoneEn: e0.zoneEn,
        zoneRu: e0.zoneRu,
        spawnEn: '',
        spawnRu: '',
      });
    }
    if (rn && rn !== zn) {
      extra.push({
        key: rn,
        zoneEn: e0.zoneEn,
        zoneRu: e0.zoneRu,
        spawnEn: '',
        spawnRu: '',
      });
    }
  }
  const merged = [...buildSortedMatchers(catalog), ...extra];
  merged.sort((a, b) => b.key.length - a.key.length);
  const seen = new Set();
  /** @type {typeof merged} */
  const uniq = [];
  for (const m of merged) {
    if (seen.has(m.key)) continue;
    seen.add(m.key);
    uniq.push(m);
  }
  return uniq;
}

/** Suffix `?` or `❓` = force empty spawn after match. */
const UNKNOWN_SPAWN_SUFFIX_RE = /\s*[\u003f\u2753]\s*$/u;

/**
 * @param {string} token
 * @param {{ key: string, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} matchers
 */
function matchSlotToken(token, matchers) {
  const n = normToken(token);
  if (!n) return null;
  for (const m of matchers) {
    if (m.key === n) {
      return {
        zoneEn: m.zoneEn,
        zoneRu: m.zoneRu,
        spawnEn: m.spawnEn,
        spawnRu: m.spawnRu,
      };
    }
  }
  return null;
}

/**
 * @param {string} token
 * @param {{ key: string, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} matchers
 */
function matchSlotTokenAllowUnknownSpawn(token, matchers) {
  const hadUnknown = UNKNOWN_SPAWN_SUFFIX_RE.test(token);
  const base = token.replace(UNKNOWN_SPAWN_SUFFIX_RE, '').trim();
  const cell = matchSlotToken(base, matchers);
  if (!cell) return null;
  if (hadUnknown) {
    return { ...cell, spawnEn: '', spawnRu: '' };
  }
  return cell;
}

/**
 * @param {SpawnCatalogEntry[]} catalog
 * @param {number} [maxWaves] default 3 (full game has 15)
 */
export function buildExampleWaveLines(catalog, maxWaves = 3) {
  if (catalog.length === 0) return [];
  const n = Math.min(Math.max(1, maxWaves), TOTAL_WAVES);
  let idx = 0;
  /** @type {string[]} */
  const lines = [];
  for (let w = 1; w <= n; w++) {
    const slots = [];
    for (let s = 0; s < SLOTS_PER_WAVE; s++) {
      slots.push(catalog[idx % catalog.length].displayLine);
      idx++;
    }
    lines.push(`${w}. ${slots.join(', ')}`);
  }
  return lines;
}

const LINE_RE = /^\s*(\d+)\s*\.\s*(.+)$/;

/**
 * @param {string} text
 * @param {SpawnCatalogEntry[]} catalog
 */
export function parseBulkWavesText(text, catalog) {
  const matchers = buildSortedMatchersWithZoneOnly(catalog);
  /** @type {Map<number, string[]>} */
  const waveMap = new Map();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(LINE_RE);
    if (!m) {
      return {
        ok: false,
        kind: 'bad_line',
        raw: text,
        badLine: trimmed,
      };
    }
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_WAVES) {
      return { ok: false, kind: 'bad_wave_num', raw: text, wave: n };
    }
    if (waveMap.has(n)) {
      return { ok: false, kind: 'dup_wave', raw: text, wave: n };
    }
    const rest = m[2].trim();
    const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length !== SLOTS_PER_WAVE) {
      return {
        ok: false,
        kind: 'bad_slot_count',
        raw: text,
        wave: n,
        parts,
      };
    }
    waveMap.set(n, parts);
  }

  if (waveMap.size !== TOTAL_WAVES) {
    return {
      ok: false,
      kind: 'missing_waves',
      raw: text,
      got: [...waveMap.keys()].sort((a, b) => a - b),
    };
  }
  for (let w = 1; w <= TOTAL_WAVES; w++) {
    if (!waveMap.has(w)) {
      return {
        ok: false,
        kind: 'missing_waves',
        raw: text,
        got: [...waveMap.keys()].sort((a, b) => a - b),
      };
    }
  }

  /** @type {{ wave: number, slotIdx: number, token: string }[]} */
  const slotErrors = [];
  /** @type {{ w: number, s: number, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} */
  const assignments = [];

  for (let w = 1; w <= TOTAL_WAVES; w++) {
    const parts = /** @type {string[]} */ (waveMap.get(w));
    for (let si = 0; si < SLOTS_PER_WAVE; si++) {
      const token = parts[si];
      const cell = matchSlotTokenAllowUnknownSpawn(token, matchers);
      if (!cell) {
        slotErrors.push({ wave: w, slotIdx: si, token });
      } else {
        assignments.push({
          w,
          s: si + 1,
          zoneEn: cell.zoneEn,
          zoneRu: cell.zoneRu,
          spawnEn: cell.spawnEn,
          spawnRu: cell.spawnRu,
        });
      }
    }
  }

  if (slotErrors.length > 0) {
    return {
      ok: false,
      kind: 'bad_slots',
      raw: text,
      waveMap,
      slotErrors,
    };
  }

  return { ok: true, assignments, waveMap };
}

/**
 * @param {object} result
 * @param {'en' | 'ru'} locale
 */
export function formatBulkParseFailure(result, locale) {
  const loc = locale ?? 'en';
  const esc = (x) => escapeDiscordBoldSegment(x);
  if (result.kind === 'bad_line') {
    const line = esc(result.badLine ?? '');
    return `${t(loc, 'bulk_err_bad_line')}\n**${line}**`;
  }
  if (result.kind === 'bad_wave_num') {
    return `${t(loc, 'bulk_err_bad_wave_num')} (${result.wave})`;
  }
  if (result.kind === 'dup_wave') {
    return `${t(loc, 'bulk_err_dup_wave')} (${result.wave})`;
  }
  if (result.kind === 'bad_slot_count') {
    const w = result.wave;
    return t(loc, 'bulk_err_bad_slot_count').replace('{wave}', String(w));
  }
  if (result.kind === 'missing_waves') {
    return t(loc, 'bulk_err_missing_waves');
  }
  if (result.kind === 'bad_slots') {
    const echo = formatSlotErrorsEcho(result.waveMap, result.slotErrors);
    const head = t(loc, 'bulk_err_bad_slots');
    const block = `${head}\n\n${echo}`;
    return block.length > EMBED_DESC_MAX
      ? truncateTo(block, EMBED_DESC_MAX)
      : block;
  }
  return t(loc, 'bulk_err_unknown');
}

export function formatSlotErrorsEcho(waveMap, slotErrors) {
  const errKey = new Set(slotErrors.map((e) => `${e.wave}:${e.slotIdx}`));
  /** @type {string[]} */
  const lines = [];
  for (let w = 1; w <= TOTAL_WAVES; w++) {
    const parts = /** @type {string[]} */ (waveMap.get(w));
    const formatted = parts.map((p, si) => {
      const seg = escapeDiscordBoldSegment(p);
      if (errKey.has(`${w}:${si}`)) return `**${seg}**`;
      return seg;
    });
    lines.push(`${w}. ${formatted.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} draft
 * @param {{ w: number, s: number, zoneEn: string, zoneRu: string, spawnEn: string, spawnRu: string }[]} assignments
 */
export function applyBulkAssignments(draft, assignments) {
  for (const a of assignments) {
    setWaveCell(draft, a.w, a.s, {
      zoneEn: a.zoneEn,
      zoneRu: a.zoneRu,
      spawnEn: a.spawnEn,
      spawnRu: a.spawnRu,
    });
  }
}

/**
 * @param {'en' | 'ru'} locale
 * @param {SpawnCatalogEntry[]} catalog
 * @param {string[]} exampleLines
 */
function buildInstructionBody(locale, catalog, exampleLines) {
  const lines = [];
  const intro = t(locale, 'bulk_intro').trim();
  if (intro) {
    lines.push(intro);
    lines.push('');
  }
  lines.push(t(locale, 'bulk_spawn_names_header'));
  for (const e of catalog) {
    lines.push(`> ${e.displayLine}`);
  }
  lines.push('');
  lines.push(t(locale, 'bulk_format_header'));
  lines.push('```');
  for (const el of exampleLines) {
    lines.push(el);
  }
  lines.push('```');
  lines.push(`*${t(locale, 'bulk_format_and_so_on')}*`);
  lines.push('');
  lines.push(t(locale, 'bulk_reply_hint'));
  return lines.join('\n');
}

/**
 * @param {string} body
 * @param {'en' | 'ru'} locale
 * @param {number} maxLen
 */
function shrinkBodyIfNeeded(body, locale, maxLen) {
  if (body.length <= maxLen) return body;
  const sep = t(locale, 'bulk_format_header');
  const i = body.indexOf(sep);
  if (i < 0) return truncateTo(body, maxLen);
  const head = body.slice(0, i).trimEnd();
  const tail = body.slice(i);
  const headLines = head.split('\n');
  if (headLines.length > 28) {
    const shrunk = [
      ...headLines.slice(0, 4),
      '…',
      ...headLines.slice(-3),
      '',
    ].join('\n');
    const merged = `${shrunk}\n${tail}`;
    return merged.length <= maxLen ? merged : truncateTo(merged, maxLen);
  }
  return truncateTo(body, maxLen);
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncateTo(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * @param {object} session
 * @param {{ en: object[], ru: object[], weeksList: object[] }} rotations
 */
export function buildBulkInstructionMain(session, rotations) {
  const locale = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
  const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
  if (!ctx) {
    return {
      ok: false,
      content:
        locale === 'ru'
          ? 'Неделя не найдена в rotation JSON.'
          : 'Week not found in rotation JSON.',
    };
  }
  const { enMap, ruMap } = ctx;
  const catalog = buildSpawnCatalog(enMap, ruMap, locale);
  const exampleLines = buildExampleWaveLines(catalog, 3);
  let body = buildInstructionBody(locale, catalog, exampleLines);
  body = shrinkBodyIfNeeded(body, locale, DISCORD_MAX - 400);
  return { ok: true, content: body, catalog };
}

/**
 * @param {object} session
 * @param {{ en: object[], ru: object[], weeksList: object[] }} rotations
 */
export function buildBulkInputPayload(session, rotations) {
  const locale = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
  const main = buildBulkInstructionMain(session, rotations);
  if (!main.ok) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix('waves:bulk:cancel', session.sourceCommand))
        .setLabel(trunc(t(locale, 'bulk_cancel'), 80))
        .setStyle(ButtonStyle.Danger),
    );
    return { content: main.content, components: [row], embeds: [] };
  }

  let content = main.content;
  if (content.length > DISCORD_MAX) {
    content = truncateTo(content, DISCORD_MAX);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(appendFlowSuffix('waves:bulk:cancel', session.sourceCommand))
      .setLabel(trunc(t(locale, 'bulk_cancel'), 80))
      .setStyle(ButtonStyle.Danger),
  );

  /** @type {import('discord.js').EmbedBuilder[]} */
  const embeds = [];
  if (session.bulkParseError) {
    let desc = session.bulkParseError;
    if (desc.length > EMBED_DESC_MAX) {
      desc = truncateTo(desc, EMBED_DESC_MAX);
    }
    embeds.push(
      new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription(desc),
    );
  }

  return { content, components: [row], embeds };
}

/**
 * @param {string} s
 * @param {number} max
 */
function trunc(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
