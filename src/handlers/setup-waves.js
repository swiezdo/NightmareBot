import {
  ActionRowBuilder,
  ChannelType,
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
} from '../data/rotation.js';
import { getSession, saveSession, deleteSession } from '../db/session.js';
import { appendFlowSuffix, stripFlowSuffix } from '../wizard/wave-custom-id.js';
import { buildMessagePayload } from '../wizard/ui.js';
import { setWaveCell, isGridComplete } from '../wizard/grid.js';
import { loadPublishedDraft, savePublishedDraft } from '../db/tsushima-publish.js';
import {
  buildTsushimaApiPayload,
  CREDIT_TEXT_MAX,
  DEFAULT_TSUSHIMA_CREDIT_TEXT,
  pushTsushimaToNightmare,
  summarizeNightmareApiFailure,
} from '../api/nightmare-tsushima.js';
import { GRID_PAGE_COUNT, SLOTS_PER_WAVE, TOTAL_WAVES } from '../wizard/constants.js';

const DISCORD_CONTENT_MAX = 2000;

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
async function publishTsushimaAfterCredits(interaction, session, loc) {
  const apiUrl = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_URL ?? '').trim();
  const apiToken = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN ?? '').trim();

  await interaction.deferReply({ ephemeral: true });

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

    try {
      savePublishedDraft(session.game, session.draft);
    } catch (e) {
      console.error('savePublishedDraft after API ok', e);
      await interaction.editReply({ content: t(loc, 'save_error') });
      if (session.messageId && interaction.channel?.isTextBased()) {
        try {
          const m = await interaction.channel.messages.fetch(session.messageId);
          await m.edit({ content: t(loc, 'save_error'), components: [], embeds: [] });
        } catch {
          /* ignore */
        }
      }
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

    if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        const m = await interaction.channel.messages.fetch(session.messageId);
        await m.edit({
          content: finalContent,
          components: [],
          embeds: [],
        });
      } catch (e) {
        console.error('edit wizard after publish', e);
      }
    }
  } catch (e) {
    console.error('publishTsushimaAfterCredits', e);
    await interaction.editReply({ content: t(loc, 'api_network_error') });
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

/** @param {string | undefined} raw */
export function parseAllowedUserIds(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  const s = String(raw).trim();
  try {
    if (s.startsWith('[')) {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return new Set(arr.map((x) => String(x)));
    }
  } catch {
    /* fall through */
  }
  return new Set(
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {Set<string>} allowed
 */
async function ensureDm(interaction, allowed) {
  const ch = interaction.channel;
  if (ch && ch.type === ChannelType.DM) return true;
  const loc = allowed.has(interaction.user.id) ? 'ru' : 'en';
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t(loc, 'dm_only'), ephemeral: true });
  }
  return false;
}

/**
 * @param {string} userId
 * @param {string} game
 * @param {{ draft?: object, sourceCommand?: string }} [options]
 */
function newSession(userId, game, options = {}) {
  const sourceCommand = options.sourceCommand ?? 'setup-waves';
  return {
    userId,
    game,
    sourceCommand,
    locale: null,
    messageId: null,
    channelId: null,
    draft: options.draft ?? createEmptyDraft(),
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
  const allowed = parseAllowedUserIds(process.env.SETUP_WAVES_ALLOWED_USER_IDS);

  if (!allowed.has(interaction.user.id)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: t('ru', 'forbidden'), ephemeral: true });
    }
    return;
  }

  if (!(await ensureDm(interaction, allowed))) return;

  const rotations = loadRotations();

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-waves') {
    const game = interaction.options.getString('game', true);
    if (game !== 'tsushima') {
      await interaction.reply({ content: t('en', 'game_not_available'), ephemeral: true });
      return;
    }

    const prev = getSession(interaction.user.id, 'setup-waves');
    const session = newSession(interaction.user.id, game, { sourceCommand: 'setup-waves' });
    if (prev?.messageId && prev?.channelId) {
      session.messageId = prev.messageId;
      session.channelId = prev.channelId;
    }

    const payload = buildMessagePayload(session, rotations);

    if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        const msg = await interaction.channel.messages.fetch(session.messageId);
        await msg.edit(payload);
        saveSession(session);
        await interaction.reply({
          content: `${t('ru', 'setup_reset')} · ${t('en', 'setup_reset')}`,
          ephemeral: true,
        });
        return;
      } catch {
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
    if (game !== 'tsushima') {
      await interaction.reply({ content: t('en', 'game_not_available'), ephemeral: true });
      return;
    }

    const loaded = loadPublishedDraft(game);
    if (!loaded.ok) {
      const loc = allowed.has(interaction.user.id) ? 'ru' : 'en';
      const key =
        loaded.reason === 'missing' ? 'edit_tsushima_missing' : 'edit_tsushima_invalid';
      await interaction.reply({ content: t(loc, key), ephemeral: true });
      return;
    }

    const prev = getSession(interaction.user.id, 'edit-waves');
    const session = newSession(interaction.user.id, game, {
      sourceCommand: 'edit-waves',
      draft: loaded.draft,
    });
    if (prev?.messageId && prev?.channelId) {
      session.messageId = prev.messageId;
      session.channelId = prev.channelId;
    }

    const payload = buildMessagePayload(session, rotations);

    if (session.messageId && interaction.channel?.isTextBased()) {
      try {
        const msg = await interaction.channel.messages.fetch(session.messageId);
        await msg.edit(payload);
        saveSession(session);
        await interaction.reply({
          content: `${t('ru', 'edit_panel_reopened')} · ${t('en', 'edit_panel_reopened')}`,
          ephemeral: true,
        });
        return;
      } catch {
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

  if (interaction.isModalSubmit()) {
    const rawId = interaction.customId ?? '';
    if (!rawId.startsWith('waves:credits_modal')) return;
    const { id, flow } = stripFlowSuffix(rawId);
    if (id !== 'waves:credits_modal') return;

    const sessionModal = getSession(interaction.user.id, flow);
    if (!sessionModal) {
      await interaction.reply({
        content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
        ephemeral: true,
      });
      return;
    }

    const locModal = /** @type {'en' | 'ru'} */ (sessionModal.locale ?? 'en');
    const rawCredits = interaction.fields.getTextInputValue('credits') ?? '';
    sessionModal.draft.credits = rawCredits.trim() || DEFAULT_TSUSHIMA_CREDIT_TEXT;
    saveSession(sessionModal);
    await publishTsushimaAfterCredits(interaction, sessionModal, locModal);
    return;
  }

  if (!interaction.isMessageComponent()) return;

  const { id, flow } = stripFlowSuffix(interaction.customId);
  let session = getSession(interaction.user.id, flow);
  if (!session) {
    await interaction.reply({
      content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
      ephemeral: true,
    });
    return;
  }

  if (id.startsWith('waves:lang:')) {
    const loc = id.endsWith(':ru') ? 'ru' : 'en';
    session.locale = loc;
    session.uiStep = session.sourceCommand === 'edit-waves' ? 'grid' : 'week';
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (interaction.isStringSelectMenu() && id === 'waves:week' && flow === 'setup-waves') {
    const code = interaction.values[0];
    const ctx = findWeekContext(rotations.en, rotations.ru, code);
    if (!ctx) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, rotations);
      await interaction.message.edit(
        mergePayloadContent(t(loc, 'week_select_failed'), payload),
      );
      return;
    }
    session.draft = buildDraftFromWeek(ctx);
    session.uiStep = 'grid';
    session.gridPage = 0;
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:bulk:open') {
    if (session.uiStep !== 'grid' || isGridComplete(session.draft)) {
      await interaction.deferUpdate();
      await interaction.message.edit(buildMessagePayload(session, rotations));
      return;
    }
    session.uiStep = 'bulk_input';
    session.bulkParseError = null;
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:bulk:cancel') {
    if (session.uiStep !== 'bulk_input') {
      await interaction.deferUpdate();
      await interaction.message.edit(buildMessagePayload(session, rotations));
      return;
    }
    session.uiStep = 'grid';
    session.bulkParseError = null;
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:p:prev' || id === 'waves:p:next') {
    const cur = session.gridPage ?? 0;
    session.gridPage =
      id === 'waves:p:prev'
        ? Math.max(0, cur - 1)
        : Math.min(GRID_PAGE_COUNT - 1, cur + 1);
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id.startsWith('waves:c:')) {
    const [, , g, s] = id.split(':');
    const group = Number(g);
    const slot = Number(s);
    if (group < 1 || group > TOTAL_WAVES || slot < 1 || slot > SLOTS_PER_WAVE) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      await interaction.deferUpdate();
      try {
        await interaction.followUp({ content: t(loc, 'invalid_wave_slot'), ephemeral: true });
      } catch {
        /* ignore */
      }
      await interaction.message.edit(buildMessagePayload(session, rotations));
      return;
    }
    session.pendingWave = group;
    session.pendingSpawn = slot;
    session.pendingZoneIndex = null;
    session.uiStep = 'zone';
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:back:grid') {
    session.uiStep = 'grid';
    session.pendingWave = null;
    session.pendingSpawn = null;
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:back:zone') {
    session.uiStep = 'zone';
    session.pendingZoneIndex = null;
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id.startsWith('waves:z:')) {
    const zi = Number(id.split(':')[2]);
    session.pendingZoneIndex = zi;
    const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
    if (!ctx) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, rotations);
      await interaction.message.edit(
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
      await interaction.message.edit(buildMessagePayload(session, rotations));
      return;
    }

    session.uiStep = 'spawn';
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id.startsWith('waves:s:')) {
    const si = Number(id.split(':')[2]);
    const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
    if (!ctx || session.pendingZoneIndex == null) {
      const loc = /** @type {'en' | 'ru'} */ (session.locale);
      session.uiStep = 'grid';
      session.pendingWave = null;
      session.pendingSpawn = null;
      session.pendingZoneIndex = null;
      saveSession(session);
      await interaction.deferUpdate();
      const payload = buildMessagePayload(session, rotations);
      const prefix = !ctx
        ? t(loc, 'week_not_in_rotation')
        : t(loc, 'invalid_wave_slot');
      await interaction.message.edit(mergePayloadContent(prefix, payload));
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
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (id === 'waves:done') {
    const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');

    if (!isGridComplete(session.draft)) {
      await interaction.deferUpdate();
      try {
        await interaction.followUp({
          content: t(loc, 'grid_incomplete').slice(0, DISCORD_CONTENT_MAX),
          ephemeral: true,
        });
      } catch {
        /* ignore */
      }
      return;
    }

    const apiUrl = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_URL ?? '').trim();
    const apiToken = String(process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN ?? '').trim();

    if (!apiUrl || !apiToken) {
      await interaction.deferUpdate();
      try {
        await interaction.followUp({
          content: t(loc, 'api_not_configured').slice(0, DISCORD_CONTENT_MAX),
          ephemeral: true,
        });
      } catch {
        /* ignore */
      }
      return;
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
          ephemeral: true,
        });
      } catch {
        /* ignore */
      }
    }
  }
}
