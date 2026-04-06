import fs from 'node:fs';
import { TSUSHIMA_OUTPUT_PATH } from '../paths.js';
import { normalizeDraftShape } from '../data/rotation.js';

/**
 * @typedef {{ ok: true, draft: object }} LoadOk
 * @typedef {{ ok: false, reason: 'missing' | 'invalid' | 'empty' }} LoadErr
 */

/**
 * Read first map object from waves/tsushima.json and normalize to draft shape.
 * @returns {LoadOk | LoadErr}
 */
export function loadDraftForEdit() {
  if (!fs.existsSync(TSUSHIMA_OUTPUT_PATH)) {
    return { ok: false, reason: 'missing' };
  }

  /** @type {unknown} */
  let parsed;
  try {
    const raw = fs.readFileSync(TSUSHIMA_OUTPUT_PATH, 'utf8');
    parsed = JSON.parse(raw);
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
