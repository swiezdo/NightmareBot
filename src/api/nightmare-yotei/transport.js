import { readJsonOrNull, readJsonOrParseError } from '../nightmare-http.js';

const DEFAULT_YOTEI_READ_URL = 'https://nightmare.club/api/rotation/yotei';

/**
 * URL для GET текущей ротации Yōtei. NIGHTMARE_CLUB_YOTEI_READ_URL;
 * иначе из NIGHTMARE_CLUB_YOTEI_URL: …/api/rotations/yotei → …/api/rotation/yotei.
 */
export function getYoteiRotationReadUrl() {
  const explicit = process.env.NIGHTMARE_CLUB_YOTEI_READ_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const putUrl = process.env.NIGHTMARE_CLUB_YOTEI_URL?.trim();
  if (putUrl) {
    const derived = putUrl.replace(/\/api\/rotations\/yotei\/?$/i, '/api/rotation/yotei');
    if (derived !== putUrl) return derived.replace(/\/$/, '');
  }
  return DEFAULT_YOTEI_READ_URL;
}

/**
 * URL для PUT (`/api/rotations/yotei`). Явный **NIGHTMARE_CLUB_YOTEI_URL**;
 * иначе из read URL: …/api/rotation/yotei → …/api/rotations/yotei.
 *
 * @returns {string} пустая строка, если вывести нельзя
 */
export function getYoteiRotationPutUrl() {
  const explicitPut = process.env.NIGHTMARE_CLUB_YOTEI_URL?.trim();
  if (explicitPut) return explicitPut.replace(/\/$/, '');

  const readUrl = getYoteiRotationReadUrl();
  const derived = readUrl.replace(/\/api\/rotation\/yotei\/?$/i, '/api/rotations/yotei');
  if (derived !== readUrl) return derived.replace(/\/$/, '');

  return '';
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ url: string, token: string }} options
 * @returns {Promise<{ ok: boolean, status: number, json: unknown }>}
 */
export async function pushYoteiToNightmare(payload, { url, token }) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await readJsonOrParseError(res);
  const bodyOk =
    json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    /** @type {{ ok?: boolean }} */ (json).ok === true;

  return { ok: res.ok && bodyOk, status: res.status, json };
}

/**
 * @param {{ url?: string, token: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export async function fetchYoteiRotationRead(opts) {
  const url = (opts.url ?? getYoteiRotationReadUrl()).replace(/\/$/, '');
  const token = String(opts.token ?? '').trim();
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await readJsonOrNull(res);
  return { ok: res.ok, status: res.status, data };
}
