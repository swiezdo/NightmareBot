import { MessageFlags } from 'discord.js';
import { t } from '../../i18n/strings.js';
import { deleteSession } from '../../db/session.js';
import {
  buildTsushimaApiPayload,
  DEFAULT_TSUSHIMA_CREDIT_TEXT,
  getTsushimaRotationPutUrl,
  pushTsushimaToNightmare,
  summarizeNightmareApiFailure,
} from '../../api/nightmare-tsushima.js';
import {
  buildYoteiApiPayload,
  getYoteiRotationPutUrl,
  pushYoteiToNightmare,
} from '../../api/nightmare-yotei.js';

export const DISCORD_CONTENT_MAX = 2000;

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
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {string} content
 * @param {string} logContext
 */
async function closeWizardPanel(interaction, session, content, logContext) {
  const wizardEditPayload = {
    content,
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
        console.error(logContext, e);
      }
    }
  }
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
export async function publishTsushimaAfterCredits(interaction, session, loc) {
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
    await closeWizardPanel(interaction, session, finalContent, 'edit wizard after publish');
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
export async function publishYoteiAfterCredits(interaction, session, loc) {
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
    await closeWizardPanel(interaction, session, finalContent, 'edit wizard after yotei publish');
  } catch (e) {
    console.error('publishYoteiAfterCredits', e);
    await interaction.editReply({ content: t(loc, 'api_network_error') });
  }
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} session
 * @param {'en' | 'ru'} loc
 */
export async function finishYoteiAfterCredits(interaction, session, loc) {
  const creditsFinal = String(session.draft?.credits ?? '').trim() || DEFAULT_TSUSHIMA_CREDIT_TEXT;

  await interaction.deferReply();
  deleteSession(interaction.user.id, session.sourceCommand);

  let body = `${t(loc, 'yotei_publish_not_implemented')}\n\n${t(loc, 'yotei_credits_local_note')}`;
  const room = DISCORD_CONTENT_MAX - body.length - 2;
  if (room > 20 && creditsFinal) {
    const snippet = creditsFinal.length > room ? `${creditsFinal.slice(0, room - 1)}…` : creditsFinal;
    body = `${body}\n${snippet}`;
  }
  if (body.length > DISCORD_CONTENT_MAX) {
    body = `${body.slice(0, DISCORD_CONTENT_MAX - 1)}…`;
  }

  await interaction.editReply({ content: body });
  await closeWizardPanel(interaction, session, body, 'edit wizard after yotei credits');
}
