import { getDb } from './database.js';
import { normalizeDraftShape } from '../data/rotation.js';

/**
 * @typedef {{ ok: true, draft: object }} LoadOk
 * @typedef {{ ok: false, reason: 'missing' | 'invalid' | 'empty' }} LoadErr
 */

/**
 * @param {string} game
 * @returns {LoadOk | LoadErr}
 */
export function loadPublishedDraft(game) {
  const row = /** @type {{ payload: string } | undefined} */ (
    getDb()
      .prepare('SELECT payload FROM waves_tsushima_publish WHERE game = ?')
      .get(game)
  );
  if (!row) return { ok: false, reason: 'missing' };

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const first = parsed[0];
  if (!first || typeof first !== 'object') {
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, draft: normalizeDraftShape(first) };
}

/**
 * @param {string} game
 * @param {object} draft
 */
export function savePublishedDraft(game, draft) {
  const payload = JSON.stringify([draft]);
  const updated_at = Date.now();
  getDb()
    .prepare(
      `
      INSERT INTO waves_tsushima_publish (game, payload, updated_at)
      VALUES (@game, @payload, @updated_at)
      ON CONFLICT(game) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `,
    )
    .run({ game, payload, updated_at });
}
