import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
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
  createEmptyDraft,
  createEmptyYoteiDraft,
} from '../data/rotation.js';
import {
  loadYoteiLabels,
  buildYoteiDraftForCycleWeek,
} from '../data/yotei-labels.js';
import {
  getYoteiMapZoneRows,
  YOTEI_SPAWN_SLUGS,
  labelForYoteiSpawnSlug,
} from '../data/yotei-map-zones.js';
import { loadSession, saveSession, deleteSession } from '../db/session.js';
import { editExpiredWizardMessageFromInteraction } from '../utils/session-expired-wizard.js';
import { appendFlowSuffix, stripFlowSuffix } from '../wizard/wave-custom-id.js';
import { buildMessagePayload } from '../wizard/ui.js';
import { setWaveCell, isGridComplete } from '../wizard/grid.js';
import {
  buildDraftFromTsushimaReadApi,
  buildTsushimaApiPayload,
  CREDIT_TEXT_MAX,
  DEFAULT_TSUSHIMA_CREDIT_TEXT,
  fetchTsushimaRotationRead,
  getTsushimaRotationPutUrl,
  pushTsushimaToNightmare,
  summarizeNightmareApiFailure,
} from '../api/nightmare-tsushima.js';
import {
  fetchYoteiRotationRead,
  buildDraftFromYoteiReadApi,
  buildYoteiApiPayload,
  getYoteiRotationPutUrl,
  pushYoteiToNightmare,
} from '../api/nightmare-yotei.js';
import { getWaveGridSpec } from '../wizard/game-geometry.js';
import { isAllowedForSetupCommands } from '../utils/setup-access.js';

const DISCORD_CONTENT_MAX = 2000;

/**
 * @param {{ en: object[], ru: object[], weeksList: object[] }} rotations
 * @param {import('../data/yotei-labels.js').YoteiLabels} yoteiLabels
 */
function wizardUiContext(rotations, yoteiLabels) {
  return { rotations, yoteiLabels };
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
async function publishTsushimaAfterCredits(interaction, session, loc) {
  const apiUrl = getTsushimaRotationPutUrl();
  const apiToken = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN ?? '').trim();

  await interaction.deferReply();

  if (!apiUrl || !apiToken) {
    await interaction.editReply({
      content: t(loc, 'api_not_configured').slice(0, DISCORD_CONTENT_MAX),
    });
    return;
  }

  /** @type {Record<string, unknown>} */
  let payload;
  try {
    payload = buildTsushimaApiPayload(session.draft);
  } catch (e) {
    console.error('buildTsushimaApiPayload', e);
    await interaction.editReply({ content: t(loc, 'api_payload_error') });
    return;
  }

  try {
    const result = await pushTsushimaToNightmare(payload, { url: apiUrl, token: apiToken });
    if (!result.ok) {
      console.error('pushTsushimaToNightmare', result.status, result.json);
      const detail = summarizeNightmareApiFailure(result);
      const msg = `${t(loc, 'api_publish_failed_prefix')}\n${detail}`.slice(0, DISCORD_CONTENT_MAX);
      await interaction.editReply({ content: msg });
      return;
    }

    deleteSession(interaction.user.id, session.sourceCommand);

    const weekStart =
      result.json &&
      typeof result.json === 'object' &&
      result.json !== null &&
      'week_start' in result.json
        ? String(/** @type {{ week_start?: string }} */ (result.json).week_start ?? '')
        : '';
    const weekLine = weekStart ? `\n${t(loc, 'api_week_line').replace('{week}', weekStart)}` : '';
    const finalContent = `${t(loc, 'saved_success_api')}${weekLine}\n${t(loc, 'confirm_saved')}`.slice(
      0,
      DISCORD_CONTENT_MAX,
    );

    await interaction.editReply({ content: finalContent });

    const wizardEditPayload = {
      content: finalContent,
      components: [],
      embeds: [],
    };

    /** @type {import('discord.js').Message | null} */
    let wizardMsg = null;
    if (interaction.isFromMessage()) {
      wizardMsg = interaction.message;
    } else if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        wizardMsg = await interaction.channel.messages.fetch(session.messageId);
      } catch {
        wizardMsg = null;
      }
    }

    if (wizardMsg && !wizardMsg.flags.has(MessageFlags.Ephemeral)) {
      try {
        await wizardMsg.edit(wizardEditPayload);
      } catch (e) {
        if (!isDiscordUnknownMessage(e)) {
          console.error('edit wizard after publish', e);
        }
      }
    }
  } catch (e) {
    console.error('publishTsushimaAfterCredits', e);
    await interaction.editReply({ content: t(loc, 'api_network_error') });
  }
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
async function publishYoteiAfterCredits(interaction, session, loc) {
  const apiUrl = getYoteiRotationPutUrl();
  const apiToken = String(process.env.NIGHTMARE_CLUB_YOTEI_TOKEN ?? '').trim();

  await interaction.deferReply();

  if (!apiUrl || !apiToken) {
    await interaction.editReply({
      content: t(loc, 'waves_yotei_publish_not_configured').slice(0, DISCORD_CONTENT_MAX),
    });
    return;
  }

  /** @type {Record<string, unknown>} */
  let payload;
  try {
    payload = buildYoteiApiPayload(session.draft);
  } catch (e) {
    console.error('buildYoteiApiPayload', e);
    await interaction.editReply({ content: t(loc, 'api_payload_error') });
    return;
  }

  try {
    const result = await pushYoteiToNightmare(payload, { url: apiUrl, token: apiToken });
    if (!result.ok) {
      console.error('pushYoteiToNightmare', result.status, result.json);
      const detail = summarizeNightmareApiFailure(result);
      const msg = `${t(loc, 'api_publish_failed_prefix')}\n${detail}`.slice(0, DISCORD_CONTENT_MAX);
      await interaction.editReply({ content: msg });
      return;
    }

    deleteSession(interaction.user.id, session.sourceCommand);

    const weekStart =
      result.json &&
      typeof result.json === 'object' &&
      result.json !== null &&
      'week_start' in result.json
        ? String(/** @type {{ week_start?: string }} */ (result.json).week_start ?? '')
        : '';
    const weekLine = weekStart ? `\n${t(loc, 'api_week_line').replace('{week}', weekStart)}` : '';
    const finalContent = `${t(loc, 'saved_success_api')}${weekLine}\n${t(loc, 'confirm_saved')}`.slice(
      0,
      DISCORD_CONTENT_MAX,
    );

    await interaction.editReply({ content: finalContent });

    const wizardEditPayload = {
      content: finalContent,
      components: [],
      embeds: [],
    };

    /** @type {import('discord.js').Message | null} */
    let wizardMsg = null;
    if (interaction.isFromMessage()) {
      wizardMsg = interaction.message;
    } else if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        wizardMsg = await interaction.channel.messages.fetch(session.messageId);
      } catch {
        wizardMsg = null;
      }
    }

    if (wizardMsg && !wizardMsg.flags.has(MessageFlags.Ephemeral)) {
      try {
        await wizardMsg.edit(wizardEditPayload);
      } catch (e) {
        if (!isDiscordUnknownMessage(e)) {
          console.error('edit wizard after yotei publish', e);
        }
      }
    }
  } catch (e) {
    console.error('publishYoteiAfterCredits', e);
    await interaction.editReply({ content: t(loc, 'api_network_error') });
  }
}

/**
 * После модалки Credits для Yōtei, если PUT не настроен: закрыть сессию и заглушка.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
async function finishYoteiAfterCredits(interaction, session, loc) {
  const creditsFinal = String(session.draft?.credits ?? '').trim() || DEFAULT_TSUSHIMA_CREDIT_TEXT;

  await interaction.deferReply();

  deleteSession(interaction.user.id, session.sourceCommand);

  let body = `${t(loc, 'yotei_publish_not_implemented')}\n\n${t(loc, 'yotei_credits_local_note')}`;
  const room = DISCORD_CONTENT_MAX - body.length - 2;
  if (room > 20 && creditsFinal) {
    const snippet =
      creditsFinal.length > room ? `${creditsFinal.slice(0, room - 1)}…` : creditsFinal;
    body = `${body}\n${snippet}`;
  }
  if (body.length > DISCORD_CONTENT_MAX) {
    body = `${body.slice(0, DISCORD_CONTENT_MAX - 1)}…`;
  }

  await interaction.editReply({ content: body });

  const wizardEditPayload = {
    content: body,
    components: [],
    embeds: [],
  };

  /** @type {import('discord.js').Message | null} */
  let wizardMsg = null;
  if (interaction.isFromMessage()) {
    wizardMsg = interaction.message;
  } else if (session.messageId && interaction.channel?.isTextBased()) {
    try {
      wizardMsg = await interaction.channel.messages.fetch(session.messageId);
    } catch {
      wizardMsg = null;
    }
  }

  if (wizardMsg && !wizardMsg.flags.has(MessageFlags.Ephemeral)) {
    try {
      await wizardMsg.edit(wizardEditPayload);
    } catch (e) {
      if (!isDiscordUnknownMessage(e)) {
        console.error('edit wizard after yotei credits', e);
      }
    }
  }
}

/**
 * @param {string} [prefix]
 * @param {{ content: string, components: import('discord.js').ActionRowBuilder[], embeds?: import('discord.js').EmbedBuilder[] }} payload
 */
function mergePayloadContent(prefix, payload) {
  let content = prefix ? `${prefix}\n\n${payload.content}` : payload.content;
  if (content.length > DISCORD_CONTENT_MAX) {
    content = `${content.slice(0, DISCORD_CONTENT_MAX - 1)}…`;
  }
  return {
    content,
    components: payload.components,
    embeds: payload.embeds ?? [],
  };
}

/**
 * @param {unknown} e
 */
function isDiscordUnknownMessage(e) {
  return (
    e !== null &&
    typeof e === 'object' &&
    'code' in e &&
    /** @type {{ code?: number }} */ (e).code === 10_008
  );
}

/**
 * After deferUpdate: обновить сообщение мастера через interaction.editReply (тот же webhook, что и у slash/кнопки).
 * При удалении сообщения (10008) — сбрасываем session.messageId и шлём followUp с подсказкой.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {object} session
 * @param {import('discord.js').InteractionEditReplyOptions} payload
 */
async function editWizardMessageOrRecover(interaction, session, payload) {
  try {
    await interaction.editReply(payload);
  } catch (e) {
    if (!isDiscordUnknownMessage(e)) throw e;
    session.messageId = null;
    session.channelId = null;
    saveSession(session);
    const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
    try {
      await interaction.followUp({
        content: t(loc, 'wizard_message_deleted').slice(0, DISCORD_CONTENT_MAX),
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {import('discord.js').Interaction} interaction
 */
async function ensureDm(interaction) {
  const ch = interaction.channel;
  if (ch && ch.type === ChannelType.DM) return true;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t('en', 'dm_only'), ephemeral: true });
  }
  return false;
}

/**
 * @param {string} userId
 * @param {string} game
 * @param {{ draft?: object, sourceCommand?: string }} [options]
 */
/**
 * Закрыть панель мастера другого потока (setup ↔ edit), чтобы в ЛС не оставалось двух наборов кнопок.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {'setup-waves' | 'edit-waves'} otherFlow
 */
async function dismissOtherFlowSession(interaction, otherFlow) {
  const loaded = loadSession(interaction.user.id, otherFlow);
  if (loaded.status !== 'ok') return;
  const ch = interaction.channel;
  const mid = loaded.session.messageId;
  if (mid && ch?.isTextBased()) {
    try {
      await ch.messages.delete(mid);
    } catch {
      /* сообщение уже удалено или недоступно */
    }
  }
  deleteSession(interaction.user.id, otherFlow);
}

function newSession(userId, game, options = {}) {
  const sourceCommand = options.sourceCommand ?? 'setup-waves';
  const defaultDraft =
    options.draft ??
    (game === 'yotei' ? createEmptyYoteiDraft() : createEmptyDraft());
  return {
    userId,
    game,
    sourceCommand,
    locale: null,
    messageId: null,
    channelId: null,
    draft: defaultDraft,
    uiStep: 'lang',
    gridPage: 0,
    pendingWave: null,
    pendingSpawn: null,
    pendingZoneIndex: null,
  };
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} _client
 */
export async function handleSetupWavesInteraction(interaction, _client) {
  if (!isAllowedForSetupCommands(interaction.user.id)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: t('ru', 'forbidden'),
        ephemeral: interaction.inGuild(),
      });
    }
    return;
  }

  if (!(await ensureDm(interaction))) return;

  const rotations = loadRotations();
  const yoteiLabels = loadYoteiLabels();
  const uiCtx = () => wizardUiContext(rotations, yoteiLabels);

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-waves') {
    const game = interaction.options.getString('game', true);
    if (game !== 'tsushima' && game !== 'yotei') {
      await interaction.reply({ content: t('en', 'game_not_available') });
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

        const ack = `${t('ru', 'setup_reset')} · ${t('en', 'setup_reset')}`;
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
      await interaction.reply({ content: t('en', 'game_not_available') });
      return;
    }

    const loc = isAllowedForSetupCommands(interaction.user.id) ? 'ru' : 'en';
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

          let ack = `${t('ru', 'edit_panel_reopened')} · ${t('en', 'edit_panel_reopened')}`;
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

        let ack = `${t('ru', 'edit_panel_reopened')} · ${t('en', 'edit_panel_reopened')}`;
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
      await interaction.reply({
        content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
      });
      return;
    }
    if (loadedModal.status !== 'ok') {
      await interaction.reply({
        content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
      });
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
    await interaction.reply({
      content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
    });
    return;
  }
  let session = loaded.status === 'ok' ? loaded.session : null;
  if (!session) {
    await interaction.reply({
      content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
    });
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
    const spRu = normalizeSpawns(ruMap.zones_spawns[zi]?.spawns);

    if (spEn.length <= 1) {
      const zoneEn = enMap.zones_spawns[zi].zone;
      const zoneRu = ruMap.zones_spawns[zi].zone;
      setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
        zoneEn,
        zoneRu,
        spawnEn: spEn[0] ?? '',
        spawnRu: spRu[0] ?? '',
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
      setWaveCell(
        session.draft,
        /** @type {number} */ (session.pendingWave),
        /** @type {number} */ (session.pendingSpawn),
        {
          zoneEn: zy.location,
          zoneRu: zy.zoneRu,
          spawnEn: '',
          spawnRu: '',
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
    const zoneRuU = ruU.zones_spawns[ziU].zone;
    setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
      zoneEn: zoneEnU,
      zoneRu: zoneRuU,
      spawnEn: '',
      spawnRu: '',
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
      const locSpawn = /** @type {'en' | 'ru'} */ (session.locale);
      setWaveCell(
        session.draft,
        /** @type {number} */ (session.pendingWave),
        /** @type {number} */ (session.pendingSpawn),
        {
          zoneEn: zs.location,
          zoneRu: zs.zoneRu,
          spawnEn: spawnSlug,
          spawnRu: labelForYoteiSpawnSlug(zs, spawnSlug, locSpawn),
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
    const spRu = normalizeSpawns(ruMap.zones_spawns[zi]?.spawns);
    const zoneEn = enMap.zones_spawns[zi].zone;
    const zoneRu = ruMap.zones_spawns[zi].zone;

    setWaveCell(session.draft, /** @type {number} */ (session.pendingWave), /** @type {number} */ (session.pendingSpawn), {
      zoneEn,
      zoneRu,
      spawnEn: spEn[si] ?? '',
      spawnRu: spRu[si] ?? '',
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
