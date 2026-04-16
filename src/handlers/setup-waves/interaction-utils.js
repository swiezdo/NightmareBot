import { t } from '../../i18n/strings.js';
import { saveSession } from '../../db/session.js';

export const DISCORD_CONTENT_MAX = 2000;

/**
 * @param {string} [prefix]
 * @param {{ content: string, components: import('discord.js').ActionRowBuilder[], embeds?: import('discord.js').EmbedBuilder[] }} payload
 */
export function mergePayloadContent(prefix, payload) {
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
export function isDiscordUnknownMessage(e) {
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
export async function editWizardMessageOrRecover(interaction, session, payload) {
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
