import { ChannelType } from 'discord.js';
import { t } from '../i18n/strings.js';
import {
  loadRotations,
  findWeekContext,
  normalizeSpawns,
  buildDraftFromWeek,
  createEmptyDraft,
} from '../data/rotation.js';
import { getSession, saveSession, deleteSession } from '../db/session.js';
import { buildMessagePayload } from '../wizard/ui.js';
import { setWaveCell } from '../wizard/grid.js';
import { writeTsushimaFile } from '../wizard/write-tsushima.js';
import { GRID_PAGE_COUNT, SLOTS_PER_WAVE, TOTAL_WAVES } from '../wizard/constants.js';

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

function newSession(userId, game) {
  return {
    userId,
    game,
    locale: null,
    messageId: null,
    channelId: null,
    draft: createEmptyDraft(),
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

    const prev = getSession(interaction.user.id);
    const session = newSession(interaction.user.id, game);
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

  if (!interaction.isMessageComponent()) return;

  let session = getSession(interaction.user.id);
  if (!session) {
    await interaction.reply({
      content: `${t('ru', 'session_stale')}\n${t('en', 'session_stale')}`,
      ephemeral: true,
    });
    return;
  }

  const id = interaction.customId;

  if (id.startsWith('waves:lang:')) {
    const loc = id.endsWith(':ru') ? 'ru' : 'en';
    session.locale = loc;
    session.uiStep = 'week';
    saveSession(session);
    await interaction.deferUpdate();
    await interaction.message.edit(buildMessagePayload(session, rotations));
    return;
  }

  if (interaction.isStringSelectMenu() && id === 'waves:week') {
    const code = interaction.values[0];
    const ctx = findWeekContext(rotations.en, rotations.ru, code);
    if (!ctx) {
      await interaction.deferUpdate();
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
      await interaction.deferUpdate();
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
      await interaction.deferUpdate();
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
      await interaction.deferUpdate();
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
    const loc = /** @type {'en' | 'ru'} */ (session.locale);
    try {
      writeTsushimaFile(session.draft);
      deleteSession(interaction.user.id);
      await interaction.deferUpdate();
      await interaction.message.edit({
        content: `${t(loc, 'saved_success')}\n${t(loc, 'confirm_saved')}`,
        components: [],
      });
    } catch (e) {
      console.error('writeTsushimaFile', e);
      await interaction.deferUpdate();
      await interaction.message.edit({
        content: t(loc, 'save_error'),
        components: [],
      });
    }
  }
}
