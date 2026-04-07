import { SLOTS_PER_WAVE, TOTAL_WAVES } from '../wizard/constants.js';

/** Matches nightmare-club schema maxLength for credit_text. */
const CREDIT_TEXT_MAX = 500;

/**
 * Minimal body for PUT /api/rotations/tsushima (whitelist only).
 * Omits credit_text when empty.
 *
 * @param {object} draft — session.draft from rotation wizard
 * @returns {Record<string, unknown>}
 */
export function buildTsushimaApiPayload(draft) {
  const map_slug = String(draft.map_slug ?? '').trim();
  const week_code = String(draft.week ?? '').trim();
  if (!map_slug || !week_code) {
    throw new Error('draft missing map_slug or week_code');
  }

  const waves = [];
  for (let w = 1; w <= TOTAL_WAVES; w += 1) {
    const waveObj = draft.waves?.[`wave_${w}`];
    const spawns = [];
    for (let s = 1; s <= SLOTS_PER_WAVE; s += 1) {
      const cell = waveObj?.[`${s}`];
      spawns.push({
        order: s,
        zone: String(cell?.zone_en ?? '').trim(),
        spawn: String(cell?.spawn_en ?? '').trim(),
      });
    }
    waves.push({ wave: w, spawns });
  }

  /** @type {Record<string, unknown>} */
  const out = { map_slug, week_code, waves };
  const credits = String(draft.credits ?? '').trim();
  if (credits) {
    out.credit_text = credits.slice(0, CREDIT_TEXT_MAX);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ url: string, token: string }} options
 * @returns {Promise<{ ok: boolean, status: number, json: unknown }>}
 */
export async function pushTsushimaToNightmare(payload, { url, token }) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  /** @type {unknown} */
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _parse_error: true, _raw: text.slice(0, 500) };
  }

  const bodyOk =
    json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    /** @type {{ ok?: boolean }} */ (json).ok === true;

  return { ok: res.ok && bodyOk, status: res.status, json };
}

const DEFAULT_TSUSHIMA_READ_URL = 'https://nightmare.club/api/rotation/tsushima';

/**
 * URL для GET текущей ротации (read-only). Переопределение: NIGHTMARE_CLUB_TSUSHIMA_READ_URL;
 * иначе из NIGHTMARE_CLUB_TSUSHIMA_URL: …/api/rotations/tsushima → …/api/rotation/tsushima.
 */
export function getTsushimaRotationReadUrl() {
  const explicit = process.env.NIGHTMARE_CLUB_TSUSHIMA_READ_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const putUrl = process.env.NIGHTMARE_CLUB_TSUSHIMA_URL?.trim();
  if (putUrl) {
    const derived = putUrl.replace(/\/api\/rotations\/tsushima\/?$/i, '/api/rotation/tsushima');
    if (derived !== putUrl) return derived.replace(/\/$/, '');
  }
  return DEFAULT_TSUSHIMA_READ_URL;
}

/**
 * @param {{ url?: string, token: string, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export async function fetchTsushimaRotationRead(opts) {
  const url = (opts.url ?? getTsushimaRotationReadUrl()).replace(/\/$/, '');
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

/**
 * Short user-facing detail for follow-up message (truncated).
 *
 * @param {{ ok: boolean, status: number, json: unknown }} result
 * @param {number} [maxLen]
 */
export function summarizeNightmareApiFailure(result, maxLen = 1700) {
  const j = result.json;
  if (j && typeof j === 'object' && !Array.isArray(j) && /** @type {{ _parse_error?: boolean }} */ (j)._parse_error) {
    const raw = /** @type {{ _raw?: string }} */ (j)._raw;
    const base = raw || `HTTP ${result.status}`;
    return base.slice(0, maxLen);
  }

  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const errObj = /** @type {{ error?: { message?: string, details?: { path?: string, message?: string }[] } }} */ (
      j
    ).error;
    if (errObj && typeof errObj === 'object') {
      const msg = String(errObj.message ?? 'Request failed');
      const details = errObj.details;
      let extra = '';
      if (Array.isArray(details) && details.length > 0) {
        const lines = details.slice(0, 8).map((d) => {
          const p = d.path != null ? String(d.path) : '';
          const m = d.message != null ? String(d.message) : '';
          return p ? `${p}: ${m}` : m;
        });
        extra = `\n${lines.join('\n')}`;
      }
      return (msg + extra).slice(0, maxLen);
    }
  }

  return `HTTP ${result.status}`.slice(0, maxLen);
}
