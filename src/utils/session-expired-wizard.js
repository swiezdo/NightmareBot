import { t } from '../i18n/strings.js';

const DISCORD_CONTENT_MAX = 2000;

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
 * Обновить сообщение мастера после TTL-удаления сессии (если сообщение ещё есть).
 *
 * @param {import('discord.js').TextBasedChannel | null | undefined} channel
 * @param {{ messageId?: string | null, locale?: string | null }} meta
 */
export async function editExpiredWizardMessage(channel, meta) {
  const messageId = meta.messageId;
  const loc = meta.locale === 'ru' ? 'ru' : 'en';
  if (!channel?.isTextBased() || !messageId) return;
  try {
    const msg = await channel.messages.fetch(messageId);
    const content = t(loc, 'session_expired_idle').slice(0, DISCORD_CONTENT_MAX);
    await msg.edit({ content, components: [], embeds: [] });
  } catch (e) {
    if (!isDiscordUnknownMessage(e)) {
      console.warn('[session-expired] edit wizard message:', e?.message ?? e);
    }
  }
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {{ messageId?: string | null, channelId?: string | null, locale?: string | null }} meta
 */
export async function editExpiredWizardMessageFromInteraction(interaction, meta) {
  let ch = interaction.channel?.isTextBased() ? interaction.channel : null;
  if (!ch && meta.channelId) {
    try {
      const fetched = await interaction.client.channels.fetch(meta.channelId);
      if (fetched?.isTextBased()) ch = fetched;
    } catch {
      /* ignore */
    }
  }
  if (ch && 'partial' in ch && ch.partial && typeof ch.fetch === 'function') {
    try {
      ch = await ch.fetch();
    } catch {
      return;
    }
  }
  await editExpiredWizardMessage(ch, meta);
}
