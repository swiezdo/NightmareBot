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

  const text = await res.text();
  /** @type {unknown} */
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}
