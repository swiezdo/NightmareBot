import { getSession } from './session.js';

/**
 * @param {import('discord.js').Message} message
 * @returns {{ session: object, flow: 'setup-waves' | 'edit-waves' } | null}
 */
export function resolveBulkInputSession(message) {
  const userId = message.author.id;
  /** @type {const} */
  const flows = ['setup-waves', 'edit-waves'];
  /** @type {{ session: object, flow: (typeof flows)[number] }[]} */
  const hits = [];
  for (const flow of flows) {
    const s = getSession(userId, flow);
    if (s?.uiStep === 'bulk_input') hits.push({ session: s, flow });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const refId = message.reference?.messageId;
  if (refId) {
    const byRef = hits.find((h) => h.session.messageId === refId);
    if (byRef) return byRef;
  }
  return null;
}
