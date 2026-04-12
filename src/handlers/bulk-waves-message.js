import { ChannelType } from 'discord.js';
import { loadRotations, findWeekContext } from '../data/rotation.js';
import { loadYoteiLabels } from '../data/yotei-labels.js';
import { saveSession } from '../db/session.js';
import { resolveBulkInputSession } from '../db/bulk-session.js';
import { buildMessagePayload } from '../wizard/ui.js';
import {
  buildSpawnCatalog,
  parseBulkWavesText,
  parseBulkYoteiWavesText,
  buildYoteiSpawnCatalog,
  applyBulkAssignments,
  formatBulkParseFailure,
} from '../wizard/bulk-waves-text.js';
import { isAllowedForSetupCommands } from '../utils/setup-access.js';

/**
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {object} session
 * @param {{ rotations: { en: object[], ru: object[], weeksList: object[] }, yoteiLabels: import('../data/yotei-labels.js').YoteiLabels }} ctx
 */
async function replaceWizardMessage(channel, session, ctx) {
  const payload = buildMessagePayload(session, ctx);
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
  if (!isAllowedForSetupCommands(message.author.id)) return;

  const resolved = await resolveBulkInputSession(message);
  if (!resolved) return;

  const { session } = resolved;
  const rotations = loadRotations();
  const yoteiLabels = loadYoteiLabels();
  const ctx = { rotations, yoteiLabels };
  const loc = /** @type {'en' | 'ru'} */ (session.locale ?? 'en');
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

  if (session.game === 'yotei') {
    const slug = String(session.draft?.map_slug ?? '').trim();
    const cw = Number(session.draft?.week ?? 0);
    if (!slug || cw < 1) {
      session.uiStep = 'grid';
      session.bulkParseError = null;
      try {
        await replaceWizardMessage(ch, session, ctx);
      } catch (e) {
        console.error('bulk DM: replace after missing yotei week/map', e);
      }
      return;
    }

    const catalog = buildYoteiSpawnCatalog(slug, loc);
    const parsed = parseBulkYoteiWavesText(message.content, catalog);

    if (!parsed.ok) {
      session.bulkParseError = formatBulkParseFailure(parsed, loc, 'yotei');
      try {
        await replaceWizardMessage(ch, session, ctx);
      } catch (e) {
        console.error('bulk DM: replace on parse error (yotei)', e);
      }
      return;
    }

    applyBulkAssignments(session.draft, parsed.assignments);
    session.uiStep = 'grid';
    session.bulkParseError = null;
    try {
      await replaceWizardMessage(ch, session, ctx);
    } catch (e) {
      console.error('bulk DM: replace on success (yotei)', e);
    }
    return;
  }

  const weekCtx = findWeekContext(rotations.en, rotations.ru, session.draft.week);
  if (!weekCtx) {
    session.uiStep = 'grid';
    session.bulkParseError = null;
    try {
      await replaceWizardMessage(ch, session, ctx);
    } catch (e) {
      console.error('bulk DM: replace after missing week', e);
    }
    return;
  }

  const catalog = buildSpawnCatalog(weekCtx.enMap, weekCtx.ruMap, loc);
  const parsed = parseBulkWavesText(message.content, catalog);

  if (!parsed.ok) {
    session.bulkParseError = formatBulkParseFailure(parsed, loc, 'tsushima');
    try {
      await replaceWizardMessage(ch, session, ctx);
    } catch (e) {
      console.error('bulk DM: replace on parse error', e);
    }
    return;
  }

  applyBulkAssignments(session.draft, parsed.assignments);
  session.uiStep = 'grid';
  session.bulkParseError = null;
  try {
    await replaceWizardMessage(ch, session, ctx);
  } catch (e) {
    console.error('bulk DM: replace on success', e);
  }
}
