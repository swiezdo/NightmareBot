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
import { WAVES_PER_PAGE } from './constants.js';
import { getWaveGridSpec } from './game-geometry.js';
import {
  buildYoteiCycleWeekSelectOptions,
  loadYoteiLabels,
  resolveYoteiChallengeCard,
  resolveYoteiMapTitle,
} from '../data/yotei-labels.js';
import { getYoteiMapZoneRows, YOTEI_SPAWN_SLUGS } from '../data/yotei-map-zones.js';
import { appendFlowSuffix } from './wave-custom-id.js';
import { buildBulkInputPayload } from './bulk-waves-text.js';

const LABEL_MAX = 100;
const MOD_TRUNC = 120;
const HIDDEN_TEMPLE_MAP_SLUG = 'hidden-temple';
const YOTEI_ATTUNEMENT_BUTTONS = [
  { id: 'sun', name: 'Sun', emoji: '🟡' },
  { id: 'moon', name: 'Moon', emoji: '🔵' },
  { id: 'storm', name: 'Storm', emoji: '🟢' },
];

/**
 * @typedef {import('../data/yotei-labels.js').YoteiLabels} YoteiLabels
 * @typedef {{ en: object[], ru: object[], weeksList: { code: string, labelEn: string, labelRu: string }[] }} TsushimaRotations
 * @typedef {{ rotations: TsushimaRotations, yoteiLabels: YoteiLabels | null }} WizardUiContext
 */

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
 * @param {import('./game-geometry.js').WizardGame} game
 */
function formatGridPageLine(locale, draftWavePage, game = 'tsushima') {
  const tot = getWaveGridSpec(game).gridPageCount;
  return t(locale, 'grid_page')
    .replace('{cur}', String(draftWavePage + 1))
    .replace('{tot}', String(tot));
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
 * @param {object} session
 * @param {import('./game-geometry.js').WizardGame} game
 */
function waveRow(W, draft, session, game = 'tsushima') {
  const spec = getWaveGridSpec(game);
  const row = new ActionRowBuilder();
  const slots = spec.slotsForWave(W);
  for (let s = 1; s <= slots; s++) {
    const filled = isCellFilled(draft, W, s, game);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(appendFlowSuffix(`waves:c:${W}:${s}`, session.sourceCommand))
        .setLabel(`${W}.${s}`)
        .setStyle(filled ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  return row;
}

/**
 * Row 4: ⬅️ | [✅ Done when grid complete] | ➡️
 * @param {'en' | 'ru'} locale
 * @param {import('./game-geometry.js').WizardGame} game
 */
function navRow(locale, page, complete, session, game = 'tsushima') {
  const spec = getWaveGridSpec(game);
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
      .setDisabled(page >= spec.gridPageCount - 1),
  );

  return row;
}

/**
 * @param {object} session
 * @param {WizardUiContext} ctx
 */
function buildMessagePayloadCore(session, ctx) {
  const { rotations, yoteiLabels: ylFromCtx } = ctx;
  const yoteiLabels = ylFromCtx ?? loadYoteiLabels();
  const game = session.game === 'yotei' ? 'yotei' : 'tsushima';

  if (session.uiStep === 'bulk_input') {
    return buildBulkInputPayload(session, ctx);
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
      .setPlaceholder(trunc(t(locale, 'week_select_placeholder'), 150));

    if (game === 'yotei') {
      for (const opt of buildYoteiCycleWeekSelectOptions(yoteiLabels, locale)) {
        const label = trunc(opt.label, LABEL_MAX);
        const value = `yotei:${opt.week}:${opt.mapSlug}`;
        select.addOptions(new StringSelectMenuOptionBuilder().setLabel(label).setValue(value));
      }
      return {
        content: t(locale, 'choose_yotei_cycle_week'),
        components: [new ActionRowBuilder().addComponents(select)],
      };
    }

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
    const spec = getWaveGridSpec(game);
    const page = Math.min(Math.max(0, session.gridPage ?? 0), spec.gridPageCount - 1);
    const base = page * WAVES_PER_PAGE;
    const complete = isGridComplete(draft, game);

    let content = t(locale, 'choose_wave');
    content += `\n${formatGridPageLine(locale, page, game)}`;

    if (game === 'yotei') {
      const mapTitle = resolveYoteiMapTitle(yoteiLabels, draft.map_slug, locale, draft.map_slug);
      const wk = Number(draft.week ?? 0);
      if (wk > 0) {
        content += `\n**${t(locale, 'yotei_cycle_week_prefix')}** ${wk} — ${mapTitle}`;
      } else {
        content += `\n**${t(locale, 'week_prefix')}** ${mapTitle}`;
      }
      const slugs = draft.challenge_cards_slugs;
      if (slugs === null) {
        content += `\n${t(locale, 'yotei_challenges_unknown')}`;
      } else if (Array.isArray(slugs) && slugs.length > 0) {
        content += `\n**${t(locale, 'yotei_challenge_cards_prefix')}**`;
        let cardIdx = 0;
        for (const slug of slugs) {
          cardIdx += 1;
          const key = String(slug ?? '').trim();
          if (!key) {
            content += `\n${cardIdx}. —`;
          } else {
            const line = resolveYoteiChallengeCard(yoteiLabels, key, locale, '');
            const esc = escapeDiscordItalic(trunc(line, MOD_TRUNC));
            content += `\n${cardIdx}. *${esc}*`;
          }
        }
      }
    } else if (draft.week) {
      const weekCtx = findWeekContext(rotations.en, rotations.ru, draft.week);
      const mapTitle = weekCtx
        ? locale === 'en'
          ? weekCtx.enMap.name
          : weekCtx.ruMap.name
        : draft.map_name_en;
      const weekInTicks = t(locale, 'week_code_label').replace('{code}', draft.week);
      content += `\n**${t(locale, 'week_prefix')}** ${mapTitle} (\`${weekInTicks}\`)`;
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
      if (W <= spec.totalWaves) rows.push(waveRow(W, draft, session, game));
    }

    rows.push(navRow(locale, page, complete, session, game));

    return { content, components: rows };
  }

  if (game === 'yotei') {
    const slug = String(draft.map_slug ?? '').trim();
    const yZones = getYoteiMapZoneRows(slug);
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
      for (let i = 0; i < yZones.length; i++) {
        const z = yZones[i];
        const label = locale === 'en' ? z.zoneEn : z.zoneRu;
        const matchesSaved =
          cell?.zone_en &&
          cell.zone_en === z.location;
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(appendFlowSuffix(`waves:z:${i}`, session.sourceCommand))
            .setLabel(trunc(label, 80))
            .setStyle(matchesSaved ? ButtonStyle.Success : ButtonStyle.Secondary),
        );
      }
      const savedAttunements = Array.isArray(cell?.attunements)
        ? cell.attunements.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const needsAttunements = slug === HIDDEN_TEMPLE_MAP_SLUG;
      if (needsAttunements) {
        content += `\n${t(locale, 'yotei_attunement_hint')}`;
      }
      /** @type {ActionRowBuilder[]} */
      const rowsOut = [row];
      if (needsAttunements) {
        const attRow = new ActionRowBuilder();
        for (const a of YOTEI_ATTUNEMENT_BUTTONS) {
          const active = savedAttunements.includes(a.name);
          attRow.addComponents(
            new ButtonBuilder()
              .setCustomId(appendFlowSuffix(`waves:a:${a.id}`, session.sourceCommand))
              .setStyle(active ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setEmoji(a.emoji)
              .setLabel(ZWSP),
          );
        }
        rowsOut.push(attRow);
      }
      rowsOut.push(wizardBackRow(locale, 'grid', session));
      return { content, components: rowsOut };
    }

    if (session.uiStep === 'spawn') {
      const zi = /** @type {number} */ (session.pendingZoneIndex);
      const z = yZones[zi];
      const pw = session.pendingWave;
      const ps = session.pendingSpawn;
      const cell =
        pw != null && ps != null ? draft.waves[`wave_${pw}`]?.[`${ps}`] : null;

      const zoneNameRaw = z ? (locale === 'en' ? z.zoneEn : z.zoneRu) : '';
      const zoneLoc = z?.location ?? '';
      let content =
        pw != null && ps != null
          ? `${formatWaveSpawnHeader(locale, pw, ps)}\n**${t(locale, 'zone_line_prefix')}** ${trunc(zoneNameRaw, 300)}\n${t(locale, 'choose_spawn')}\n${t(locale, 'spawn_unknown_hint')}`
          : `${t(locale, 'choose_spawn')}\n${t(locale, 'spawn_unknown_hint')}`;

      if (!z) {
        return {
          content,
          components: [wizardBackRow(locale, 'zone', session)],
        };
      }

      const opts = [
        { i: 0, en: z.spawnLeftEn, ru: z.spawnLeftRu },
        { i: 1, en: z.spawnMiddleEn, ru: z.spawnMiddleRu },
        { i: 2, en: z.spawnRightEn, ru: z.spawnRightRu },
      ];
      const row = new ActionRowBuilder();
      for (const o of opts) {
        const label = locale === 'en' ? o.en : o.ru || o.en;
        const spawnSlug = YOTEI_SPAWN_SLUGS[o.i];
        const matchesSaved = Boolean(cell?.spawn_en) && cell.spawn_en === spawnSlug;
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(appendFlowSuffix(`waves:s:${o.i}`, session.sourceCommand))
            .setLabel(trunc(label || '—', 80))
            .setStyle(matchesSaved ? ButtonStyle.Success : ButtonStyle.Secondary),
        );
      }

      const unknownSaved =
        Boolean(cell?.zone_en) &&
        cell.zone_en === zoneLoc &&
        !String(cell.spawn_en ?? '').trim();
      const unkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(appendFlowSuffix('waves:spawn:unknown', session.sourceCommand))
          .setStyle(unknownSaved ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji('❓')
          .setLabel(ZWSP),
      );

      /** @type {ActionRowBuilder[]} */
      const rowsOut = [row, unkRow, wizardBackRow(locale, 'zone', session)];

      return {
        content,
        components: rowsOut,
      };
    }
  }

  const weekCtx = findWeekContext(rotations.en, rotations.ru, draft.week);
  if (!weekCtx) {
    return {
      content: locale === 'ru' ? 'Ошибка: неделя не найдена в rotation JSON.' : 'Error: week not found in rotation JSON.',
      components: [],
    };
  }

  const { enMap, ruMap } = weekCtx;
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
        cell.zone_en === enMap.zones_spawns[i].zone;
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
    const zoneEnPick = enMap.zones_spawns[zi]?.zone ?? '';
    let content =
      pw != null && ps != null
        ? `${formatWaveSpawnHeader(locale, pw, ps)}\n**${t(locale, 'zone_line_prefix')}** ${trunc(zoneNameRaw, 300)}\n${t(locale, 'choose_spawn')}\n${t(locale, 'spawn_unknown_hint')}`
        : `${t(locale, 'choose_spawn')}\n${t(locale, 'spawn_unknown_hint')}`;

    /** @type {ActionRowBuilder[]} */
    const spawnRows = [];
    let cur = new ActionRowBuilder();
    for (let i = 0; i < spEn.length; i++) {
      const label = locale === 'en' ? spEn[i] : spRu[i] ?? spEn[i];
      const matchesSaved =
        Boolean(cell?.spawn_en) &&
        cell.spawn_en === spEn[i];
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

    const unknownSaved =
      Boolean(cell?.zone_en) &&
      cell.zone_en === zoneEnPick &&
      !String(cell.spawn_en ?? '').trim();
    spawnRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(appendFlowSuffix('waves:spawn:unknown', session.sourceCommand))
          .setStyle(unknownSaved ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji('❓')
          .setLabel(ZWSP),
      ),
    );

    spawnRows.push(wizardBackRow(locale, 'zone', session));
    return { content, components: spawnRows };
  }

  return { content: '…', components: [] };
}

/**
 * @param {object} session
 * @param {WizardUiContext} ctx
 */
export function buildMessagePayload(session, ctx) {
  const p = buildMessagePayloadCore(session, ctx);
  return { ...p, embeds: p.embeds ?? [] };
}
