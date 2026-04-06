import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { strings, t } from '../i18n/strings.js';
import { findWeekContext, normalizeSpawns } from '../data/rotation.js';
import { isCellFilled, isGridComplete } from './grid.js';
import {
  GRID_PAGE_COUNT,
  SLOTS_PER_WAVE,
  TOTAL_WAVES,
  WAVES_PER_PAGE,
} from './constants.js';
import { appendFlowSuffix } from './wave-custom-id.js';
import { buildBulkInputPayload } from './bulk-waves-text.js';

const LABEL_MAX = 100;
const MOD_TRUNC = 120;

/**
 * Escape * for Discord markdown inside *…* italics.
 * @param {string} s
 */
function escapeDiscordItalic(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
}

/**
 * @param {string} s
 * @param {number} max
 */
function trunc(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * @param {'en' | 'ru'} locale
 * @param {number} draftWavePage 0-based
 */
function formatGridPageLine(locale, draftWavePage) {
  return t(locale, 'grid_page')
    .replace('{cur}', String(draftWavePage + 1))
    .replace('{tot}', String(GRID_PAGE_COUNT));
}

/**
 * @param {'en' | 'ru'} locale
 * @param {number} wave
 * @param {number} slot
 */
function formatWaveSpawnHeader(locale, wave, slot) {
  return t(locale, 'wave_spawn_header')
    .replace(/\{wave\}/g, String(wave))
    .replace('{slot}', String(slot));
}

/**
 * Red "Back" button: to grid or back to zone selection.
 * @param {'en' | 'ru'} locale
 * @param {'grid' | 'zone'} target
 */
function wizardBackRow(locale, target, session) {
  const base = target === 'grid' ? 'waves:back:grid' : 'waves:back:zone';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(appendFlowSuffix(base, session.sourceCommand))
      .setLabel(trunc(t(locale, 'btn_wizard_back'), 80))
      .setStyle(ButtonStyle.Danger),
  );
}

/** Zero-width space: emoji-only buttons still need a minimal label for the API. */
const ZWSP = '\u200b';

/**
 * @param {number} W
 * @param {object} draft
 */
function waveRow(W, draft, session) {
  const row = new ActionRowBuilder();
  for (let s = 1; s <= SLOTS_PER_WAVE; s++) {
    const filled = isCellFilled(draft, W, s);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          appendFlowSuffix(`waves:c:${W}:${s}`, session.sourceCommand),
        )
        .setLabel(`${W}.${s}`)
        .setStyle(filled ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  return row;
}

/**
 * Row 4: ⬅️ | [✅ Done when grid complete] | ➡️
 * @param {'en' | 'ru'} locale
 */
function navRow(locale, page, complete, session) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(appendFlowSuffix('waves:p:prev', session.sourceCommand))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬅️')
      .setLabel(ZWSP)
      .setDisabled(page <= 0),
  );

  if (complete) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix('waves:done', session.sourceCommand))
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✅')
        .setLabel(ZWSP),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix('waves:bulk:open', session.sourceCommand))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✏️')
        .setLabel(ZWSP),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(appendFlowSuffix('waves:p:next', session.sourceCommand))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('➡️')
      .setLabel(ZWSP)
      .setDisabled(page >= GRID_PAGE_COUNT - 1),
  );

  return row;
}

/**
 * @param {'en' | 'ru'} locale
 * @param {object} session
 * @param {{ en: object[], ru: object[], weeksList: { code: string, labelEn: string, labelRu: string }[] }} rotations
 */
export function buildMessagePayload(session, rotations) {
  if (session.uiStep === 'bulk_input') {
    return buildBulkInputPayload(session, rotations);
  }

  if (session.uiStep === 'lang') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix('waves:lang:en', session.sourceCommand))
        .setLabel(strings.en.btn_english)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🇬🇧'),
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix('waves:lang:ru', session.sourceCommand))
        .setLabel(strings.ru.btn_russian)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🇷🇺'),
    );
    return { content: strings.en.choose_language_line, components: [row] };
  }

  const locale = /** @type {'en' | 'ru'} */ (session.locale);
  const draft = session.draft;

  if (session.uiStep === 'week') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(appendFlowSuffix('waves:week', session.sourceCommand))
      .setPlaceholder(trunc(t(locale, 'choose_week'), 150));

    for (const w of rotations.weeksList) {
      const label = trunc(locale === 'en' ? w.labelEn : w.labelRu, LABEL_MAX);
      select.addOptions(
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(w.code),
      );
    }

    return {
      content: t(locale, 'choose_week'),
      components: [new ActionRowBuilder().addComponents(select)],
    };
  }

  if (session.uiStep === 'grid') {
    const page = Math.min(
      Math.max(0, session.gridPage ?? 0),
      GRID_PAGE_COUNT - 1,
    );
    const base = page * WAVES_PER_PAGE;
    const complete = isGridComplete(draft);

    let content = t(locale, 'choose_wave');
    content += `\n${formatGridPageLine(locale, page)}`;
    if (draft.week) {
      const mapTitle = locale === 'en' ? draft.map_name_en : draft.map_name_ru;
      const weekInTicks = t(locale, 'week_code_label').replace('{code}', draft.week);
      content += `\n**${t(locale, 'week_prefix')}** ${mapTitle} (\`${weekInTicks}\`)`;
      const weekCtx = findWeekContext(rotations.en, rotations.ru, draft.week);
      if (weekCtx) {
        const wk = locale === 'en' ? weekCtx.weekEn : weekCtx.weekRu;
        const m1 = escapeDiscordItalic(trunc(String(wk.mod1 ?? ''), MOD_TRUNC));
        const m2 = escapeDiscordItalic(trunc(String(wk.mod2 ?? ''), MOD_TRUNC));
        content += `\n**${t(locale, 'mods_prefix')}** *${m1}* & *${m2}*`;
      }
    }
    if (complete) {
      content += `\n${t(locale, 'all_filled_hint')}`;
    }

    const DISCORD_CONTENT_MAX = 2000;
    if (content.length > DISCORD_CONTENT_MAX) {
      content = `${content.slice(0, DISCORD_CONTENT_MAX - 1)}…`;
    }

    /** @type {ActionRowBuilder[]} */
    const rows = [];

    for (let r = 0; r < WAVES_PER_PAGE; r++) {
      const W = base + r + 1;
      if (W <= TOTAL_WAVES) rows.push(waveRow(W, draft, session));
    }

    rows.push(navRow(locale, page, complete, session));

    return { content, components: rows };
  }

  const ctx = findWeekContext(rotations.en, rotations.ru, draft.week);
  if (!ctx) {
    return {
      content: locale === 'ru' ? 'Ошибка: неделя не найдена в rotation JSON.' : 'Error: week not found in rotation JSON.',
      components: [],
    };
  }

  const { enMap, ruMap } = ctx;
  const zCount = Math.min(enMap.zones_spawns.length, ruMap.zones_spawns.length);

  if (session.uiStep === 'zone') {
    const pw = session.pendingWave;
    const ps = session.pendingSpawn;
    const cell =
      pw != null && ps != null ? draft.waves[`wave_${pw}`]?.[`${ps}`] : null;

    let content =
      pw != null && ps != null
        ? `${formatWaveSpawnHeader(locale, pw, ps)}\n${t(locale, 'choose_zone')}`
        : t(locale, 'choose_zone');

    const row = new ActionRowBuilder();
    for (let i = 0; i < zCount; i++) {
      const label =
        locale === 'en' ? enMap.zones_spawns[i].zone : ruMap.zones_spawns[i].zone;
      const matchesSaved =
        cell?.zone_en &&
        cell.zone_en === enMap.zones_spawns[i].zone &&
        cell.zone_ru === ruMap.zones_spawns[i].zone;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(appendFlowSuffix(`waves:z:${i}`, session.sourceCommand))
          .setLabel(trunc(label, 80))
          .setStyle(matchesSaved ? ButtonStyle.Success : ButtonStyle.Secondary),
      );
    }
    return {
      content,
      components: [row, wizardBackRow(locale, 'grid', session)],
    };
  }

  if (session.uiStep === 'spawn') {
    const zi = /** @type {number} */ (session.pendingZoneIndex);
    const spEn = normalizeSpawns(enMap.zones_spawns[zi]?.spawns);
    const spRu = normalizeSpawns(ruMap.zones_spawns[zi]?.spawns);
    const pw = session.pendingWave;
    const ps = session.pendingSpawn;
    const cell =
      pw != null && ps != null ? draft.waves[`wave_${pw}`]?.[`${ps}`] : null;

    const zoneNameRaw =
      locale === 'en'
        ? enMap.zones_spawns[zi]?.zone ?? ''
        : ruMap.zones_spawns[zi]?.zone ?? '';
    let content =
      pw != null && ps != null
        ? `${formatWaveSpawnHeader(locale, pw, ps)}\n**${t(locale, 'zone_line_prefix')}** ${trunc(zoneNameRaw, 300)}\n${t(locale, 'choose_spawn')}`
        : t(locale, 'choose_spawn');

    /** @type {ActionRowBuilder[]} */
    const spawnRows = [];
    let cur = new ActionRowBuilder();
    for (let i = 0; i < spEn.length; i++) {
      const label = locale === 'en' ? spEn[i] : spRu[i] ?? spEn[i];
      const matchesSaved =
        Boolean(cell?.spawn_en) &&
        (cell.spawn_en === spEn[i] || cell.spawn_ru === spRu[i]);
      cur.addComponents(
        new ButtonBuilder()
          .setCustomId(appendFlowSuffix(`waves:s:${i}`, session.sourceCommand))
          .setLabel(trunc(label, 80))
          .setStyle(matchesSaved ? ButtonStyle.Success : ButtonStyle.Secondary),
      );
      if (cur.components.length >= 5) {
        spawnRows.push(cur);
        cur = new ActionRowBuilder();
      }
    }
    if (cur.components.length) spawnRows.push(cur);
    spawnRows.push(wizardBackRow(locale, 'zone', session));
    return { content, components: spawnRows };
  }

  return { content: '…', components: [] };
}
