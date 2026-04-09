import { ChannelType } from 'discord.js';
import { t } from '../i18n/strings.js';
import { fetchTsushimaRotationRead } from '../api/nightmare-tsushima.js';
import { fetchYoteiRotationRead } from '../api/nightmare-yotei.js';
import { formatTsushimaRotationEmbedPayloads } from '../utils/tsushima-waves-format.js';
import { formatYoteiRotationEmbedPayloads } from '../utils/yotei-waves-format.js';

/**
 * /waves в ЛС или в текстовом канале гильдии; прочие контексты — эфемерное предупреждение (текст на англ.).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function ensureWavesChannel(interaction) {
  const ch = interaction.channel;
  if (!ch) return false;
  if (ch.type === ChannelType.DM) return true;
  if (interaction.inGuild() && ch.isTextBased()) return true;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t('en', 'waves_wrong_channel'), ephemeral: true });
  }
  return false;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {'en' | 'ru'}
 */
function wavesLang(interaction) {
  const raw = interaction.options.getString('lang', true);
  return raw === 'ru' ? 'ru' : 'en';
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Array<{ content: string, embeds: import('discord.js').EmbedBuilder[] }>} payloads
 */
async function replyWithEmbedPayloads(interaction, payloads) {
  const [first, ...rest] = payloads;
  await interaction.editReply({
    content: first.content || '—',
    embeds: first.embeds,
    allowedMentions: { parse: [] },
  });
  for (const p of rest) {
    await interaction.followUp({
      content: p.content || '—',
      embeds: p.embeds,
      allowedMentions: { parse: [] },
    });
  }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleWavesCommand(interaction) {
  const lang = wavesLang(interaction);
  const game = interaction.options.getString('game', true);

  if (!(await ensureWavesChannel(interaction))) return;

  if (game === 'yotei') {
    const token = process.env.NIGHTMARE_CLUB_YOTEI_TOKEN?.trim();
    if (!token) {
      await interaction.reply({ content: t(lang, 'waves_yotei_api_not_configured') });
      return;
    }

    await interaction.deferReply();

    try {
      const { ok, status, data } = await fetchYoteiRotationRead({ token });

      if (status === 401) {
        await interaction.editReply({ content: t(lang, 'waves_yotei_read_401') });
        return;
      }

      if (!ok) {
        await interaction.editReply({
          content: t(lang, 'waves_yotei_read_http').replace('{status}', String(status)),
        });
        return;
      }

      const payloads = formatYoteiRotationEmbedPayloads(data, { locale: lang });
      await replyWithEmbedPayloads(interaction, payloads);
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      await interaction.editReply({
        content: isTimeout ? t(lang, 'waves_yotei_read_timeout') : t(lang, 'waves_yotei_read_network'),
      });
    }
    return;
  }

  const token = process.env.NIGHTMARE_CLUB_TSUSHIMA_TOKEN?.trim();
  if (!token) {
    await interaction.reply({ content: t(lang, 'api_not_configured') });
    return;
  }

  await interaction.deferReply();

  try {
    const { ok, status, data } = await fetchTsushimaRotationRead({ token });

    if (status === 401) {
      await interaction.editReply({ content: t(lang, 'waves_read_401') });
      return;
    }

    if (!ok) {
      await interaction.editReply({
        content: t(lang, 'waves_read_http').replace('{status}', String(status)),
      });
      return;
    }

    const payloads = formatTsushimaRotationEmbedPayloads(data, { locale: lang });
    await replyWithEmbedPayloads(interaction, payloads);
  } catch (e) {
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await interaction.editReply({
      content: isTimeout ? t(lang, 'waves_read_timeout') : t(lang, 'waves_read_network'),
    });
  }
}
