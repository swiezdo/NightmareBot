import { ChannelType } from 'discord.js';
import { loadRotations, findWeekContext } from '../data/rotation.js';
import { saveSession } from '../db/session.js';
import { resolveBulkInputSession } from '../db/bulk-session.js';
import { buildMessagePayload } from '../wizard/ui.js';
import {
  buildSpawnCatalog,
  parseBulkWavesText,
  applyBulkAssignments,
  formatBulkParseFailure,
} from '../wizard/bulk-waves-text.js';
import { parseAllowedUserIds } from './setup-waves.js';

/**
 * Удаляет старое сообщение мастера и шлёт новое, чтобы панель была ниже ответа пользователя.
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {object} session
 * @param {{ en: object[], ru: object[], weeksList: object[] }} rotations
 */
async function replaceWizardMessage(channel, session, rotations) {
  const payload = buildMessagePayload(session, rotations);
  if (session.messageId) {
    try {
      const old = await channel.messages.fetch(session.messageId);
      await old.delete();
    } catch (e) {
      console.warn('[bulk] delete wizard message:', e?.message ?? e);
    }
  }
  const sent = await channel.send(payload);
  session.messageId = sent.id;
  session.channelId = sent.channelId;
  saveSession(session);
}

/**
 * @param {import('discord.js').Message} message
 */
export async function handleBulkWavesDmMessage(message) {
  if (message.author.bot) return;
  if (message.channel?.type !== ChannelType.DM) return;
  const allowed = parseAllowedUserIds(process.env.SETUP_WAVES_ALLOWED_USER_IDS);
  if (!allowed.has(message.author.id)) return;

  const resolved = await resolveBulkInputSession(message);
  if (!resolved) return;

  const { session } = resolved;
  const rotations = loadRotations();
  const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
  const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
  let ch = message.channel;
  if (ch.partial) {
    try {
      ch = await ch.fetch();
    } catch (e) {
      console.error('bulk DM: fetch channel', e);
      return;
    }
  }
  if (!ch.isTextBased()) return;

  if (!ctx) {
    session.uiStep = 'grid';
    session.bulkParseError = null;
    try {
      await replaceWizardMessage(ch, session, rotations);
    } catch (e) {
      console.error('bulk DM: replace after missing week', e);
    }
    return;
  }

  const catalog = buildSpawnCatalog(ctx.enMap, ctx.ruMap, loc);
  const parsed = parseBulkWavesText(message.content, catalog);

  if (!parsed.ok) {
    session.bulkParseError = formatBulkParseFailure(parsed, loc);
    try {
      await replaceWizardMessage(ch, session, rotations);
    } catch (e) {
      console.error('bulk DM: replace on parse error', e);
    }
    return;
  }

  applyBulkAssignments(session.draft, parsed.assignments);
  session.uiStep = 'grid';
  session.bulkParseError = null;
  try {
    await replaceWizardMessage(ch, session, rotations);
  } catch (e) {
    console.error('bulk DM: replace on success', e);
  }
}
