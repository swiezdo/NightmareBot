import { ChannelType } from 'discord.js';
import { t } from '../../i18n/strings.js';
import { loadSession, deleteSession } from '../../db/session.js';
import { createEmptyDraft, createEmptyYoteiDraft } from '../../data/rotation.js';

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {'en' | 'ru'} locale
 */
export async function ensureDm(interaction, locale) {
  const ch = interaction.channel;
  if (ch && ch.type === ChannelType.DM) return true;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t(locale, 'dm_only'), ephemeral: true });
  }
  return false;
}

/**
 * Закрыть панель мастера другого потока (setup ↔ edit), чтобы в ЛС не оставалось двух наборов кнопок.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {'setup-waves' | 'edit-waves'} otherFlow
 */
export async function dismissOtherFlowSession(interaction, otherFlow) {
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

/**
 * @param {string} userId
 * @param {'tsushima' | 'yotei'} game
 * @param {{ draft?: object, sourceCommand?: 'setup-waves' | 'edit-waves' }} [options]
 */
export function newSession(userId, game, options = {}) {
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
