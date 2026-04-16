import { SLOTS_PER_WAVE, TOTAL_WAVES } from '../wizard/constants.js';
import { findWeekContext, buildDraftFromWeek } from '../data/rotation.js';
import { normalizeWaveSpawns } from '../utils/tsushima-waves-format.js';
import { readJsonOrNull, readJsonOrParseError } from './nightmare-http.js';

/** Matches nightmare-club schema maxLength for credit_text. */
export const CREDIT_TEXT_MAX = 500;

/** Used when the user leaves Credits empty in the publish modal. */
export const DEFAULT_TSUSHIMA_CREDIT_TEXT = 'Submitted by NightmareBot';

/**
 * Minimal body for PUT /api/rotations/tsushima (whitelist only).
 * Always sends credit_text (default string if draft credits empty).
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

  const creditRaw = String(draft.credits ?? '').trim();
  const credit_text = (creditRaw || DEFAULT_TSUSHIMA_CREDIT_TEXT).slice(0, CREDIT_TEXT_MAX);

  return {
    map_slug,
    week_code,
    waves,
    credit_text,
  };
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

  const json = await readJsonOrParseError(res);

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
 * иначе из NIGHTMARE_CLUB_TSUSHIMA_URL: …/api/rotations/tsushima → …/api/rotation/tsushima;
 * иначе дефолтный хост публичного сайта.
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
 * URL для PUT публикации (`/api/rotations/tsushima` в [nightmare-club](https://github.com/machr/nightmare-club)).
 * Явный NIGHTMARE_CLUB_TSUSHIMA_URL;
 * иначе из эффективного read URL: …/api/rotation/tsushima → …/api/rotations/tsushima
 * (удобно, если задан только NIGHTMARE_CLUB_TSUSHIMA_READ_URL + токен);
 * при только токене без URL — read идёт на дефолтный `…/api/rotation/tsushima`, PUT выводится в `…/api/rotations/tsushima`.
 *
 * @returns {string} пустая строка, если URL вывести нельзя (нестандартный read path — задайте **NIGHTMARE_CLUB_TSUSHIMA_URL** явно)
 */
export function getTsushimaRotationPutUrl() {
  const explicitPut = process.env.NIGHTMARE_CLUB_TSUSHIMA_URL?.trim();
  if (explicitPut) return explicitPut.replace(/\/$/, '');

  const readUrl = getTsushimaRotationReadUrl();
  const derived = readUrl.replace(/\/api\/rotation\/tsushima\/?$/i, '/api/rotations/tsushima');
  if (derived !== readUrl) return derived.replace(/\/$/, '');

  return '';
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

  const data = await readJsonOrNull(res);

  return { ok: res.ok, status: res.status, data };
}

/**
 * Build wizard draft from GET /api/rotation/tsushima body + local rotation JSON.
 * Uses the first map when `maps.length > 1`.
 *
 * @param {unknown} apiJson
 * @param {{ en: import('../data/rotation.js').RotationMap[], ru: import('../data/rotation.js').RotationMap[] }} rotations
 * @returns {{ ok: true, draft: object, multiMap: boolean } | { ok: false, reason: 'empty_maps' | 'bad_shape' | 'week_unknown' }}
 */
export function buildDraftFromTsushimaReadApi(apiJson, rotations) {
  const { en, ru } = rotations;
  if (!apiJson || typeof apiJson !== 'object') {
    return { ok: false, reason: 'bad_shape' };
  }
  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return { ok: false, reason: 'empty_maps' };
  }

  const entry = maps[0];
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'bad_shape' };
  }
  const row = /** @type {Record<string, unknown>} */ (entry);
  const weekCode = String(row.week_code ?? '').trim();
  if (!weekCode) {
    return { ok: false, reason: 'bad_shape' };
  }

  const ctx = findWeekContext(en, ru, weekCode);
  if (!ctx) {
    return { ok: false, reason: 'week_unknown' };
  }

  const apiSlug = String(row.map_slug ?? '').trim();
  if (apiSlug && apiSlug !== ctx.enMap.slug) {
    console.warn(
      '[tsushima] API map_slug differs from rotation JSON:',
      apiSlug,
      'vs',
      ctx.enMap.slug,
    );
  }

  const draft = buildDraftFromWeek(ctx);
  const creditRaw = row.credit_text;
  draft.credits = creditRaw != null ? String(creditRaw) : '';

  const wavesArr = Array.isArray(row.waves) ? row.waves : [];
  for (let idx = 0; idx < wavesArr.length; idx++) {
    const w = wavesArr[idx];
    if (!w || typeof w !== 'object') continue;
    const o = /** @type {Record<string, unknown>} */ (w);
    const waveNum = Number(o.wave ?? idx + 1);
    if (!Number.isFinite(waveNum) || waveNum < 1 || waveNum > TOTAL_WAVES) continue;

    const waveKey = `wave_${waveNum}`;
    const spawns = normalizeWaveSpawns(o.spawns);
    for (const { order, zone, spawn } of spawns) {
      if (order < 1 || order > SLOTS_PER_WAVE) continue;
      const slot = String(order);
      draft.waves[waveKey][slot] = {
        zone_en: zone,
        spawn_en: spawn,
      };
    }
  }

  return { ok: true, draft, multiMap: maps.length > 1 };
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
