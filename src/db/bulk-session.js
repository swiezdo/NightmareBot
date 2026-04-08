import { loadSession } from './session.js';
import { editExpiredWizardMessage } from '../utils/session-expired-wizard.js';

/**
 * @param {import('discord.js').Message} message
 * @returns {Promise<{ session: object, flow: 'setup-waves' | 'edit-waves' } | null>}
 */
export async function resolveBulkInputSession(message) {
  const userId = message.author.id;
  /** @type {const} */
  const flows = ['setup-waves', 'edit-waves'];
  /** @type {{ session: object, flow: (typeof flows)[number] }[]} */
  const hits = [];
  for (const flow of flows) {
    const r = loadSession(userId, flow);
    if (r.status === 'expired') {
      let ch = message.channel;
      if (ch.partial) {
        try {
          ch = await ch.fetch();
        } catch {
          continue;
        }
      }
      await editExpiredWizardMessage(ch.isTextBased() ? ch : null, r);
      continue;
    }
    if (r.status === 'ok' && r.session.uiStep === 'bulk_input') hits.push({ session: r.session, flow });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const refId = message.reference?.messageId;
  if (refId) {
    const byRef = hits.find((h) => h.session.messageId === refId);
    if (byRef) return byRef;
  }
  // Два bulk_input без reply: детерминированный выбор — новее по updatedAt; при равенстве edit-waves.
  /** @type {Record<(typeof hits)[number]['flow'], number>} */
  const flowTieOrder = { 'edit-waves': 0, 'setup-waves': 1 };
  const sorted = [...hits].sort((x, y) => {
    const ax = Number(x.session.updatedAt) || 0;
    const ay = Number(y.session.updatedAt) || 0;
    if (ay !== ax) return ay - ax;
    return flowTieOrder[x.flow] - flowTieOrder[y.flow];
  });
  return sorted[0];
}
