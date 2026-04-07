import { ChannelType } from 'discord.js';
import { t } from '../i18n/strings.js';
import { fetchTsushimaRotationRead } from '../api/nightmare-tsushima.js';
import { fetchYoteiRotationRead } from '../api/nightmare-yotei.js';
import { formatTsushimaRotationChunks } from '../utils/tsushima-waves-format.js';
import { formatYoteiRotationChunks } from '../utils/yotei-waves-format.js';

/**
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {'en' | 'ru'} loc
 */
async function ensureDmOnly(interaction, loc) {
  const ch = interaction.channel;
  if (ch && ch.type === ChannelType.DM) return true;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t(loc, 'dm_only'), ephemeral: true });
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
 * @param {string[]} chunks
 */
async function replyWithChunks(interaction, chunks) {
  const [first, ...rest] = chunks;
  await interaction.editReply({
    content: first,
    allowedMentions: { parse: [] },
  });
  for (const part of rest) {
    await interaction.followUp({
      content: part,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Set<string>} allowed
 */
export async function handleWavesCommand(interaction, allowed) {
  const lang = wavesLang(interaction);
  const game = interaction.options.getString('game', true);

  if (!allowed.has(interaction.user.id)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: t(lang, 'forbidden'), ephemeral: true });
    }
    return;
  }

  if (!(await ensureDmOnly(interaction, lang))) return;

  if (game === 'yotei') {
    const token = process.env.NIGHTMARE_CLUB_YOTEI_TOKEN?.trim();
    if (!token) {
      await interaction.reply({ content: t(lang, 'waves_yotei_api_not_configured'), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

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

      const chunks = formatYoteiRotationChunks(data, { locale: lang });
      await replyWithChunks(interaction, chunks);
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
    await interaction.reply({ content: t(lang, 'api_not_configured'), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

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

    const chunks = formatTsushimaRotationChunks(data, { locale: lang });
    await replyWithChunks(interaction, chunks);
  } catch (e) {
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    await interaction.editReply({
      content: isTimeout ? t(lang, 'waves_read_timeout') : t(lang, 'waves_read_network'),
    });
  }
}
