import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { t } from '../i18n/strings.js';
import {
  loadRotations,
  findWeekContext,
  normalizeSpawns,
  buildDraftFromWeek,
} from '../data/rotation.js';
import { loadYoteiLabels, buildYoteiDraftForCycleWeek } from '../data/yotei-labels.js';
import {
  getYoteiMapZoneRows,
  YOTEI_SPAWN_SLUGS,
} from '../data/yotei-map-zones.js';
import { loadSession, saveSession } from '../db/session.js';
import { editExpiredWizardMessageFromInteraction } from '../utils/session-expired-wizard.js';
import { appendFlowSuffix, stripFlowSuffix } from '../wizard/wave-custom-id.js';
import { buildMessagePayload } from '../wizard/ui.js';
import { setWaveCell, isGridComplete } from '../wizard/grid.js';
import {
  buildDraftFromTsushimaReadApi,
  CREDIT_TEXT_MAX,
  DEFAULT_TSUSHIMA_CREDIT_TEXT,
  fetchTsushimaRotationRead,
  getTsushimaRotationPutUrl,
} from '../api/nightmare-tsushima.js';
import {
  fetchYoteiRotationRead,
  buildDraftFromYoteiReadApi,
  getYoteiRotationPutUrl,
} from '../api/nightmare-yotei.js';
import { getWaveGridSpec } from '../wizard/game-geometry.js';
import { isAllowedForSetupCommands } from '../utils/setup-access.js';
import {
  DISCORD_CONTENT_MAX,
  mergePayloadContent,
  editWizardMessageOrRecover,
} from './setup-waves/interaction-utils.js';
import {
  publishTsushimaAfterCredits,
  publishYoteiAfterCredits,
  finishYoteiAfterCredits,
} from './setup-waves/publish-after-credits.js';
import { ensureDm, dismissOtherFlowSession, newSession } from './setup-waves/session-flow.js';

const HIDDEN_TEMPLE_MAP_SLUG = 'hidden-temple';
const YOTEI_ATTUNEMENTS = ['Sun', 'Moon', 'Storm'];
const ATTUNEMENT_BY_BUTTON = {
  sun: 'Sun',
  moon: 'Moon',
  storm: 'Storm',
};

/**
 * @param {{ en: object[], ru: object[], weeksList: object[] }} rotations
 * @param {import('../data/yotei-labels.js').YoteiLabels} yoteiLabels
 */
function wizardUiContext(rotations, yoteiLabels) {
  return { rotations, yoteiLabels };
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {'en' | 'ru'}
 */
function interactionLocale(interaction) {
  const locale = String(
    (interaction.isChatInputCommand() || interaction.isMessageComponent() || interaction.isModalSubmit()
      ? interaction.locale
      : '') ?? '',
  ).toLowerCase();
  return locale.startsWith('ru') ? 'ru' : 'en';
}

/**
 * @param {object} session
 */
function isHiddenTempleYoteiSession(session) {
  return (
    session?.game === 'yotei' &&
    String(session?.draft?.map_slug ?? '').trim() === HIDDEN_TEMPLE_MAP_SLUG
  );
}

/**
 * @param {object} session
 */
function getCurrentYoteiCell(session) {
  const wave = Number(session?.pendingWave);
  const slot = Number(session?.pendingSpawn);
  if (!Number.isInteger(wave) || !Number.isInteger(slot)) return null;
  const waveKey = `wave_${wave}`;
  return session?.draft?.waves?.[waveKey]?.[String(slot)] ?? null;
}

/**
 * @param {unknown} raw
 */
function normalizeAttunementSelection(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  /** @type {string[]} */
  const out = [];
  for (const entry of arr) {
    const name = String(entry ?? '').trim();
    if (!name || !YOTEI_ATTUNEMENTS.includes(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * @param {string[]} current
 * @param {string} attName
 */
function toggleAttunementSelection(current, attName) {
  if (!YOTEI_ATTUNEMENTS.includes(attName)) return current;
  if (current.includes(attName)) return current.filter((x) => x !== attName);
  if (current.length >= 2) return current;
  return [...current, attName];
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} _client
 */
export async function handleSetupWavesInteraction(interaction, _client) {
  const loc = interactionLocale(interaction);

  if (!isAllowedForSetupCommands(interaction.user.id)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: t(loc, 'forbidden'),
        ephemeral: interaction.inGuild(),
      });
    }
    return;
  }

  if (!(await ensureDm(interaction, loc))) return;

  const rotations = loadRotations();
  const yoteiLabels = loadYoteiLabels();
  const uiCtx = () => wizardUiContext(rotations, yoteiLabels);

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-waves') {
    const game = interaction.options.getString('game', true);
    if (game !== 'tsushima' && game !== 'yotei') {
      await interaction.reply({ content: t(loc, 'game_not_available') });
      return;
    }

    const prevLoad = loadSession(interaction.user.id, 'setup-waves');
    if (prevLoad.status === 'expired') {
      await editExpiredWizardMessageFromInteraction(interaction, prevLoad);
    }
    await dismissOtherFlowSession(interaction, 'edit-waves');
    const prev = prevLoad.status === 'ok' ? prevLoad.session : null;
    const session = newSession(interaction.user.id, game, { sourceCommand: 'setup-waves' });
    if (prev?.messageId && prev?.channelId) {
      session.messageId = prev.messageId;
      session.channelId = prev.channelId;
    }

    const payload = buildMessagePayload(session, uiCtx());

    if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        try {
          const oldMsg = await interaction.channel.messages.fetch(session.messageId);
          await oldMsg.delete();
        } catch {
          /* already deleted or unavailable */
        }
        session.messageId = null;
        session.channelId = null;

        const ack = t(loc, 'setup_reset');
        await interaction.reply({ content: ack });

        /** @type {import('discord.js').Message} */
        let panelMsg;
        try {
          panelMsg = await interaction.followUp({ ...payload, fetchReply: true });
        } catch (e) {
          console.error('setup-waves followUp wizard panel', e);
          panelMsg = await interaction.channel.send(payload);
        }
        session.messageId = panelMsg.id;
        session.channelId = panelMsg.channelId;
        saveSession(session);
        return;
      } catch (e) {
        console.error('setup-waves reopen panel', e);
        session.messageId = null;
        session.channelId = null;
      }
    }

    const msg = await interaction.reply({ ...payload, fetchReply: true });
    session.messageId = msg.id;
    session.channelId = msg.channelId;
    saveSession(session);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'edit-waves') {
    const game = interaction.options.getString('game', true);
    if (game !== 'tsushima' && game !== 'yotei') {
      await interaction.reply({ content: t(loc, 'game_not_available') });
      return;
    }

    await interaction.deferReply();

    if (game === 'yotei') {
      const tokenY = String(process.env.NIGHTMARE_CLUB_YOTEI_TOKEN ?? '').trim();
      if (!tokenY) {
        await interaction.editReply({ content: t(loc, 'waves_yotei_api_not_configured') });
        return;
      }

      /** @type {unknown} */
      let dataY;
      try {
        const r = await fetchYoteiRotationRead({ token: tokenY });
        if (r.status === 401) {
          await interaction.editReply({ content: t(loc, 'waves_yotei_read_401') });
          return;
        }
        if (!r.ok) {
          await interaction.editReply({
            content: t(loc, 'waves_yotei_read_http').replace('{status}', String(r.status)),
          });
          return;
        }
        dataY = r.data;
      } catch (e) {
        const isTimeout =
          e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        await interaction.editReply({
          content: isTimeout ? t(loc, 'waves_yotei_read_timeout') : t(loc, 'waves_yotei_read_network'),
        });
        return;
      }

      const builtY = buildDraftFromYoteiReadApi(dataY, yoteiLabels);
      if (!builtY.ok) {
        const key =
          builtY.reason === 'empty_maps' ? 'edit_yotei_missing' : 'edit_yotei_invalid';
        await interaction.editReply({ content: t(loc, key) });
        return;
      }

      await dismissOtherFlowSession(interaction, 'setup-waves');

      const prevLoadY = loadSession(interaction.user.id, 'edit-waves');
      if (prevLoadY.status === 'expired') {
        await editExpiredWizardMessageFromInteraction(interaction, prevLoadY);
      }
      const prevY = prevLoadY.status === 'ok' ? prevLoadY.session : null;
      const sessionY = newSession(interaction.user.id, game, {
        sourceCommand: 'edit-waves',
        draft: builtY.draft,
      });
      if (prevY?.messageId && prevY?.channelId) {
        sessionY.messageId = prevY.messageId;
        sessionY.channelId = prevY.channelId;
      }

      const payloadY = buildMessagePayload(sessionY, uiCtx());

      if (sessionY.messageId && interaction.channel?.isTextBased()) {
        try {
          try {
            const oldMsg = await interaction.channel.messages.fetch(sessionY.messageId);
            await oldMsg.delete();
          } catch {
            /* already deleted or unavailable */
          }
          sessionY.messageId = null;
          sessionY.channelId = null;

          let ack = t(loc, 'edit_panel_reopened');
          if (builtY.multiMap) {
            ack = `${ack}\n${t(loc, 'edit_yotei_multi_map_note')}`;
          }
          await interaction.editReply({ content: ack });

          /** @type {import('discord.js').Message} */
          let panelMsg;
          try {
            panelMsg = await interaction.followUp({ ...payloadY, fetchReply: true });
          } catch (e) {
            console.error('edit-waves yotei followUp wizard panel', e);
            panelMsg = await interaction.channel.send(payloadY);
          }
          sessionY.messageId = panelMsg.id;
          sessionY.channelId = panelMsg.channelId;
          saveSession(sessionY);
          return;
        } catch (e) {
          console.error('edit-waves yotei reopen panel', e);
          sessionY.messageId = null;
          sessionY.channelId = null;
        }
      }

      const msgY = await interaction.editReply({ ...payloadY });
      sessionY.messageId = msgY.id;
      sessionY.channelId = msgY.channelId;
      saveSession(sessionY);
      if (builtY.multiMap) {
        await interaction.followUp({ content: t(loc, 'edit_yotei_multi_map_note') });
      }
      return;
    }

    const token = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN ?? '').trim();
    if (!token) {
      await interaction.editReply({ content: t(loc, 'api_not_configured') });
      return;
    }

    /** @type {unknown} */
    let data;
    try {
      const r = await fetchTsushimaRotationRead({ token });
      if (r.status === 401) {
        await interaction.editReply({ content: t(loc, 'waves_read_401') });
        return;
      }
      if (!r.ok) {
        await interaction.editReply({
          content: t(loc, 'waves_read_http').replace('{status}', String(r.status)),
        });
        return;
      }
      data = r.data;
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      await interaction.editReply({
        content: isTimeout ? t(loc, 'waves_read_timeout') : t(loc, 'waves_read_network'),
      });
      return;
    }

    const built = buildDraftFromTsushimaReadApi(data, rotations);
    if (!built.ok) {
      const key =
        built.reason === 'empty_maps'
          ? 'edit_tsushima_missing'
          : built.reason === 'week_unknown'
            ? 'edit_tsushima_week_unknown'
            : 'edit_tsushima_invalid';
      await interaction.editReply({ content: t(loc, key) });
      return;
    }

    await dismissOtherFlowSession(interaction, 'setup-waves');

    const prevLoad = loadSession(interaction.user.id, 'edit-waves');
    if (prevLoad.status === 'expired') {
      await editExpiredWizardMessageFromInteraction(interaction, prevLoad);
    }
    const prev = prevLoad.status === 'ok' ? prevLoad.session : null;
    const session = newSession(interaction.user.id, game, {
      sourceCommand: 'edit-waves',
      draft: built.draft,
    });
    if (prev?.messageId && prev?.channelId) {
      session.messageId = prev.messageId;
      session.channelId = prev.channelId;
    }

    const payload = buildMessagePayload(session, uiCtx());

    if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        try {
          const oldMsg = await interaction.channel.messages.fetch(session.messageId);
          await oldMsg.delete();
        } catch {
          /* already deleted or unavailable */
        }
        session.messageId = null;
        session.channelId = null;

        let ack = t(loc, 'edit_panel_reopened');
        if (built.multiMap) {
          ack = `${ack}\n${t(loc, 'edit_tsushima_multi_map_note')}`;
        }
        await interaction.editReply({ content: ack });

        /** @type {import('discord.js').Message} */
        let panelMsg;
        try {
          panelMsg = await interaction.followUp({ ...payload, fetchReply: true });
        } catch (e) {
          console.error('edit-waves followUp wizard panel', e);
          panelMsg = await interaction.channel.send(payload);
        }
        session.messageId = panelMsg.id;
        session.channelId = panelMsg.channelId;
        saveSession(session);
        return;
      } catch (e) {
        console.error('edit-waves reopen panel', e);
        session.messageId = null;
        session.channelId = null;
      }
    }

    const msg = await interaction.editReply({ ...payload });
    session.messageId = msg.id;
    session.channelId = msg.channelId;
    saveSession(session);
    if (built.multiMap) {
      await interaction.followUp({ content: t(loc, 'edit_tsushima_multi_map_note') });
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const rawId = interaction.customId ?? '';
    if (!rawId.startsWith('waves:credits_modal')) return;
    const { id, flow } = stripFlowSuffix(rawId);
    if (id !== 'waves:credits_modal') return;

    const loadedModal = loadSession(interaction.user.id, flow);
    if (loadedModal.status === 'expired') {
      await editExpiredWizardMessageFromInteraction(interaction, loadedModal);
      await interaction.reply({ content: t(loc, 'session_stale') });
      return;
    }
    if (loadedModal.status !== 'ok') {
      await interaction.reply({ content: t(loc, 'session_stale') });
      return;
    }
    const sessionModal = loadedModal.session;

    const locModal = /** @type {'en' | 'ru'} */ (sessionModal.locale ?? 'en');
    const rawCredits = interaction.fields.getTextInputValue('credits') ?? '';
    sessionModal.draft.credits = rawCredits.trim() || DEFAULT_TSUSHIMA_CREDIT_TEXT;

    if (sessionModal.game === 'yotei') {
      const putUrl = getYoteiRotationPutUrl();
      const tokenY = String(process.env.NIGHTMARE_CLUB_YOTEI_TOKEN ?? '').trim();
      if (!putUrl || !tokenY) {
        await finishYoteiAfterCredits(interaction, sessionModal, locModal);
        return;
      }
      await publishYoteiAfterCredits(interaction, sessionModal, locModal);
      return;
    }

    saveSession(sessionModal);
    await publishTsushimaAfterCredits(interaction, sessionModal, locModal);
    return;
  }

  if (!interaction.isMessageComponent()) return;

  const { id, flow } = stripFlowSuffix(interaction.customId);
  const loaded = loadSession(interaction.user.id, flow);
  if (loaded.status === 'expired') {
    await editExpiredWizardMessageFromInteraction(interaction, loaded);
    await interaction.reply({ content: t(loc, 'session_stale') });
    return;
  }
  let session = loaded.status === 'ok' ? loaded.session : null;
  if (!session) {
    await interaction.reply({ content: t(loc, 'session_stale') });
    return;
  }

  if (id.startsWith('waves:lang:')) {
    const loc = id.endsWith(':ru') ? 'ru' : 'en';
    session.locale = loc;
    session.uiStep = session.sourceCommand === 'edit-waves' ? 'grid' : 'week';
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (interaction.isStringSelectMenu() && id === 'waves:week' && flow === 'setup-waves') {
    const loc = /** @type {'en' | 'ru'} */ (session.locale);
    if (session.game === 'yotei') {
      const raw = interaction.values[0] ?? '';
      const m = /^yotei:(\d+):(.+)$/.exec(raw);
      if (!m) {
        await interaction.deferUpdate();
        await editWizardMessageOrRecover(
          interaction,
          session,
          mergePayloadContent(t(loc, 'week_select_failed'), buildMessagePayload(session, uiCtx())),
        );
        return;
      }
      const weekNum = Number(m[1]);
      const mapSlug = String(m[2] ?? '').trim();
      session.draft = buildYoteiDraftForCycleWeek(yoteiLabels, weekNum, mapSlug);
      session.uiStep = 'grid';
      session.gridPage = 0;
      saveSession(session);
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const code = interaction.values[0];
    const ctx = findWeekContext(rotations.en, rotations.ru, code);
    if (!ctx) {
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, uiCtx());
      await editWizardMessageOrRecover(
        interaction,
        session,
        mergePayloadContent(t(loc, 'week_select_failed'), payload),
      );
      return;
    }
    session.draft = buildDraftFromWeek(ctx);
    session.uiStep = 'grid';
    session.gridPage = 0;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:bulk:open') {
    const gridGame = session.game === 'yotei' ? 'yotei' : 'tsushima';
    if (session.uiStep !== 'grid' || isGridComplete(session.draft, gridGame)) {
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }
    session.uiStep = 'bulk_input';
    session.bulkParseError = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:bulk:cancel') {
    if (session.uiStep !== 'bulk_input') {
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }
    session.uiStep = 'grid';
    session.bulkParseError = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:p:prev' || id === 'waves:p:next') {
    const gridGame = session.game === 'yotei' ? 'yotei' : 'tsushima';
    const maxPage = getWaveGridSpec(gridGame).gridPageCount - 1;
    const cur = session.gridPage ?? 0;
    session.gridPage =
      id === 'waves:p:prev'
        ? Math.max(0, cur - 1)
        : Math.min(maxPage, cur + 1);
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id.startsWith('waves:c:')) {
    const [, , g, s] = id.split(':');
    const group = Number(g);
    const slot = Number(s);
    const gridGame = session.game === 'yotei' ? 'yotei' : 'tsushima';
    const spec = getWaveGridSpec(gridGame);
    const maxSlot = group >= 1 && group <= spec.totalWaves ? spec.slotsForWave(group) : 0;
    if (group < 1 || group > spec.totalWaves || slot < 1 || slot > maxSlot) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      await interaction.deferUpdate();
      try {
        await interaction.followUp({ content: t(loc, 'invalid_wave_slot') });
      } catch {
        /* ignore */
      }
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }
    session.pendingWave = group;
    session.pendingSpawn = slot;
    session.pendingZoneIndex = null;
    session.uiStep = 'zone';
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:back:grid') {
    session.uiStep = 'grid';
    session.pendingWave = null;
    session.pendingSpawn = null;
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:back:zone') {
    session.uiStep = 'zone';
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id.startsWith('waves:z:')) {
    const zi = Number(id.split(':')[2]);
    session.pendingZoneIndex = zi;

    if (session.game === 'yotei') {
      const slug = String(session.draft.map_slug ?? '').trim();
      const yRows = getYoteiMapZoneRows(slug);
      const locY = /** @type {'en' | 'ru'} */ (session.locale);
      if (!Number.isFinite(zi) || zi < 0 || !yRows[zi]) {
        session.uiStep = 'grid';
        session.pendingWave = null;
        session.pendingSpawn = null;
        session.pendingZoneIndex = null;
        saveSession(session);
        await interaction.deferUpdate();
        await editWizardMessageOrRecover(
          interaction,
          session,
          mergePayloadContent(t(locY, 'yotei_zone_invalid'), buildMessagePayload(session, uiCtx())),
        );
        return;
      }
      session.uiStep = 'spawn';
      saveSession(session);
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
    if (!ctx) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, uiCtx());
      await editWizardMessageOrRecover(
        interaction,
        session,
        mergePayloadContent(t(loc, 'week_not_in_rotation'), payload),
      );
      return;
    }
    const { enMap, ruMap } = ctx;
    const spEn = normalizeSpawns(enMap.zones_spawns[zi]?.spawns);

    if (spEn.length <= 1) {
      const zoneEn = enMap.zones_spawns[zi].zone;
      setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
        zoneEn,
        spawnEn: spEn[0] ?? '',
      });
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    session.uiStep = 'spawn';
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id.startsWith('waves:a:')) {
    if (!isHiddenTempleYoteiSession(session)) {
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const key = String(id.split(':')[2] ?? '').trim().toLowerCase();
    const attName = ATTUNEMENT_BY_BUTTON[key];
    const cell = getCurrentYoteiCell(session);
    if (!attName || !cell) {
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const current = normalizeAttunementSelection(cell.attunements);
    cell.attunements = toggleAttunementSelection(current, attName);
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:spawn:unknown') {
    if (session.game === 'yotei') {
      const slugU = String(session.draft.map_slug ?? '').trim();
      const yRowsU = getYoteiMapZoneRows(slugU);
      const locU = /** @type {'en' | 'ru'} */ (session.locale);
      const ziY = session.pendingZoneIndex;
      if (
        ziY == null ||
        session.pendingWave == null ||
        session.pendingSpawn == null ||
        !yRowsU[ziY]
      ) {
        session.uiStep = 'grid';
        session.pendingWave = null;
        session.pendingSpawn = null;
        session.pendingZoneIndex = null;
        saveSession(session);
        await interaction.deferUpdate();
        await editWizardMessageOrRecover(
          interaction,
          session,
          mergePayloadContent(t(locU, 'invalid_wave_slot'), buildMessagePayload(session, uiCtx())),
        );
        return;
      }
      const zy = yRowsU[ziY];
      const keepAttunements = normalizeAttunementSelection(getCurrentYoteiCell(session)?.attunements);
      setWaveCell(
        session.draft,
        /** @type {number} */ (session.pendingWave),
        /** @type {number} */ (session.pendingSpawn),
        {
          zoneEn: zy.location,
          spawnEn: '',
          attunements: keepAttunements,
        },
      );
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const ctxUnk = findWeekContext(rotations.en, rotations.ru, session.draft.week);
    if (
      !ctxUnk ||
      session.pendingZoneIndex == null ||
      session.pendingWave == null ||
      session.pendingSpawn == null
    ) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, uiCtx());
      const prefix = !ctxUnk
        ? t(loc, 'week_not_in_rotation')
        : t(loc, 'invalid_wave_slot');
      await editWizardMessageOrRecover(
        interaction,
        session,
        mergePayloadContent(prefix, payload),
      );
      return;
    }
    const ziU = session.pendingZoneIndex;
    const { enMap: enU, ruMap: ruU } = ctxUnk;
    const zoneEnU = enU.zones_spawns[ziU].zone;
    setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
      zoneEn: zoneEnU,
      spawnEn: '',
    });
    session.uiStep = 'grid';
    session.pendingWave = null;
    session.pendingSpawn = null;
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id.startsWith('waves:s:')) {
    const si = Number(id.split(':')[2]);

    if (session.game === 'yotei') {
      const slugS = String(session.draft.map_slug ?? '').trim();
      const yRowsS = getYoteiMapZoneRows(slugS);
      const locS = /** @type {'en' | 'ru'} */ (session.locale);
      const ziS = session.pendingZoneIndex;
      if (ziS == null || !Number.isFinite(si) || si < 0 || si > 2 || !yRowsS[ziS]) {
        session.uiStep = 'grid';
        session.pendingWave = null;
        session.pendingSpawn = null;
        session.pendingZoneIndex = null;
        saveSession(session);
        await interaction.deferUpdate();
        await editWizardMessageOrRecover(
          interaction,
          session,
          mergePayloadContent(t(locS, 'invalid_wave_slot'), buildMessagePayload(session, uiCtx())),
        );
        return;
      }
      const zs = yRowsS[ziS];
      const spawnSlug = YOTEI_SPAWN_SLUGS[si];
      const keepAttunements = normalizeAttunementSelection(getCurrentYoteiCell(session)?.attunements);
      setWaveCell(
        session.draft,
        /** @type {number} */ (session.pendingWave),
        /** @type {number} */ (session.pendingSpawn),
        {
          zoneEn: zs.location,
          spawnEn: spawnSlug,
          attunements: keepAttunements,
        },
      );
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      await editWizardMessageOrRecover(
        interaction,
        session,
        buildMessagePayload(session, uiCtx()),
      );
      return;
    }

    const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
    if (!ctx || session.pendingZoneIndex == null) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, uiCtx());
      const prefix = !ctx
        ? t(loc, 'week_not_in_rotation')
        : t(loc, 'invalid_wave_slot');
      await editWizardMessageOrRecover(
        interaction,
        session,
        mergePayloadContent(prefix, payload),
      );
      return;
    }
    const zi = session.pendingZoneIndex;
    const { enMap, ruMap } = ctx;
    const spEn = normalizeSpawns(enMap.zones_spawns[zi]?.spawns);
    const zoneEn = enMap.zones_spawns[zi].zone;
    setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
      zoneEn,
      spawnEn: spEn[si] ?? '',
    });
    session.uiStep = 'grid';
    session.pendingWave = null;
    session.pendingSpawn = null;
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await editWizardMessageOrRecover(
      interaction,
      session,
      buildMessagePayload(session, uiCtx()),
    );
    return;
  }

  if (id === 'waves:done') {
    const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
    const gridGame = session.game === 'yotei' ? 'yotei' : 'tsushima';

    if (!isGridComplete(session.draft, gridGame)) {
      await interaction.deferUpdate();
      try {
        await interaction.followUp({
          content: t(loc, 'grid_incomplete').slice(0, DISCORD_CONTENT_MAX),
        });
      } catch {
        /* ignore */
      }
      return;
    }

    if (gridGame === 'tsushima') {
      const apiUrl = getTsushimaRotationPutUrl();
      const apiToken = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN ?? '').trim();

      if (!apiUrl || !apiToken) {
        await interaction.deferUpdate();
        try {
          await interaction.followUp({
            content: t(loc, 'api_not_configured').slice(0, DISCORD_CONTENT_MAX),
          });
        } catch {
          /* ignore */
        }
        return;
      }
    }

    if (gridGame === 'yotei') {
      const apiUrlY = getYoteiRotationPutUrl();
      const apiTokenY = String(process.env.NIGHTMARE_CLUB_YOTEI_TOKEN ?? '').trim();
      if (!apiUrlY || !apiTokenY) {
        await interaction.deferUpdate();
        try {
          await interaction.followUp({
            content: t(loc, 'waves_yotei_publish_not_configured').slice(0, DISCORD_CONTENT_MAX),
          });
        } catch {
          /* ignore */
        }
        return;
      }
    }

    const title = t(loc, 'credits_modal_title').slice(0, 45);
    const label = t(loc, 'credits_modal_label').slice(0, 45);
    const placeholder = t(loc, 'credits_modal_placeholder').slice(0, 100);
    const input = new TextInputBuilder()
      .setCustomId('credits')
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(CREDIT_TEXT_MAX)
      .setPlaceholder(placeholder);
    const existing = String(session.draft.credits ?? '').trim();
    if (existing) {
      input.setValue(existing.slice(0, CREDIT_TEXT_MAX));
    }

    const modal = new ModalBuilder()
      .setCustomId(appendFlowSuffix('waves:credits_modal', session.sourceCommand))
      .setTitle(title)
      .addComponents(new ActionRowBuilder().addComponents(input));

    try {
      await interaction.showModal(modal);
    } catch (e) {
      console.error('showModal credits', e);
      try {
        await interaction.followUp({
          content:
            loc === 'ru'
              ? 'Не удалось открыть окно Credits. Попробуйте снова.'
              : 'Could not open the Credits modal. Try again.',
        });
      } catch {
        /* ignore */
      }
    }
  }
}
