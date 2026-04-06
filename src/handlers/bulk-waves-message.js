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
 * @param {import('discord.js').Message} message
 */
export async function handleBulkWavesDmMessage(message) {
  if (message.author.bot) return;
  if (message.channel?.type !== ChannelType.DM) return;
  const allowed = parseAllowedUserIds(process.env.SETUP_WAVES_ALLOWED_USER_IDS);
  if (!allowed.has(message.author.id)) return;

  const resolved = resolveBulkInputSession(message);
  if (!resolved) return;

  const { session } = resolved;
  const rotations = loadRotations();
  const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
  const ctx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
  if (!ctx) {
    session.uiStep = 'grid';
    session.bulkParseError = null;
    saveSession(session);
    if (message.channel?.isTextBased() && session.messageId) {
      try {
        const msg = await message.channel.messages.fetch(session.messageId);
        await msg.edit(buildMessagePayload(session, rotations));
      } catch (e) {
        console.error('bulk DM: edit after missing week', e);
      }
    }
    return;
  }

  const catalog = buildSpawnCatalog(ctx.enMap, ctx.ruMap, loc);
  const parsed = parseBulkWavesText(message.content, catalog);

  if (!parsed.ok) {
    let err = formatBulkParseFailure(parsed);
    if (err.length > 900) {
      err = `${err.slice(0, 898)}…`;
    }
    session.bulkParseError = err;
    saveSession(session);
    if (message.channel?.isTextBased() && session.messageId) {
      try {
        const msg = await message.channel.messages.fetch(session.messageId);
        await msg.edit(buildMessagePayload(session, rotations));
      } catch (e) {
        console.error('bulk DM: edit on parse error', e);
      }
    }
    return;
  }

  applyBulkAssignments(session.draft, parsed.assignments);
  session.uiStep = 'grid';
  session.bulkParseError = null;
  saveSession(session);
  if (message.channel?.isTextBased() && session.messageId) {
    try {
      const msg = await message.channel.messages.fetch(session.messageId);
      await msg.edit(buildMessagePayload(session, rotations));
    } catch (e) {
      console.error('bulk DM: edit on success', e);
    }
  }
}
