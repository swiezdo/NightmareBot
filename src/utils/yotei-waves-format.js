/** Запас под лимит Discord 2000. */
const DISCORD_CHUNK_MAX = 1900;

/**
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
function chunkByLength(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * @param {unknown} spawnsRaw
 */
function formatSpawnLine(spawn, locale) {
  if (!spawn || typeof spawn !== 'object') return '';
  const o = /** @type {Record<string, unknown>} */ (spawn);
  const loc = String(o.location ?? '').trim();
  if (!loc) return '';
  const pt = o.spawn_point != null ? String(o.spawn_point).trim() : '';
  const att = Array.isArray(o.attunements)
    ? o.attunements.map((x) => String(x).trim()).filter(Boolean)
    : [];
  let line = pt ? `${loc} — ${pt}` : loc;
  if (att.length > 0) {
    const tag = locale === 'ru' ? 'настройки' : 'attunements';
    line += ` (${tag}: ${att.join(', ')})`;
  }
  return line;
}

/**
 * @param {unknown} round
 * @param {'en' | 'ru'} locale
 */
function formatRoundBlock(round, locale) {
  if (!round || typeof round !== 'object') return '';
  const r = /** @type {Record<string, unknown>} */ (round);
  const roundNum = typeof r.round === 'number' ? r.round : '?';
  const hdr =
    locale === 'ru' ? `**Этап ${roundNum}**` : `**Round ${roundNum}**`;
  const lines = [hdr];

  const ch = r.challenge;
  if (ch && typeof ch === 'object') {
    const c = /** @type {Record<string, unknown>} */ (ch);
    const name = String(c.name ?? '').trim();
    const desc = String(c.description ?? '').trim();
    const lab = locale === 'ru' ? '**Испытание:**' : '**Challenge:**';
    if (name) lines.push(`${lab} ${name}`);
    if (desc) lines.push(desc);
  }

  const waves = Array.isArray(r.waves) ? r.waves : [];
  const sorted = [...waves].sort((a, b) => {
    const wa = a && typeof a === 'object' && typeof /** @type {{ wave?: number }} */ (a).wave === 'number' ? /** @type {{ wave?: number }} */ (a).wave : 0;
    const wb = b && typeof b === 'object' && typeof /** @type {{ wave?: number }} */ (b).wave === 'number' ? /** @type {{ wave?: number }} */ (b).wave : 0;
    return wa - wb;
  });

  for (const w of sorted) {
    if (!w || typeof w !== 'object') continue;
    const wo = /** @type {Record<string, unknown>} */ (w);
    const wn = typeof wo.wave === 'number' ? wo.wave : '?';
    const wlab = locale === 'ru' ? `**Волна ${wn}**` : `**Wave ${wn}**`;
    lines.push(wlab);
    const spawns = Array.isArray(wo.spawns) ? [...wo.spawns] : [];
    spawns.sort((a, b) => {
      const oa = a && typeof a === 'object' && /** @type {{ order?: number }} */ (a).order;
      const ob = b && typeof b === 'object' && /** @type {{ order?: number }} */ (b).order;
      return (typeof oa === 'number' ? oa : 0) - (typeof ob === 'number' ? ob : 0);
    });
    for (const s of spawns) {
      const line = formatSpawnLine(s, locale);
      if (line) lines.push(`• ${line}`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * @param {unknown} mapRow
 * @param {'en' | 'ru'} locale
 */
function formatMapBlock(mapRow, locale) {
  if (!mapRow || typeof mapRow !== 'object') return '';
  const m = /** @type {Record<string, unknown>} */ (mapRow);
  const name = String(m.name ?? '').trim() || '?';
  const mapHdr = locale === 'ru' ? `**Карта:** ${name}` : `**Map:** ${name}`;
  const lines = [mapHdr];

  const credits = m.credit_text != null ? String(m.credit_text).trim() : '';
  if (credits) {
    const cl = locale === 'ru' ? '**Благодарности:**' : '**Credits:**';
    lines.push(`${cl} ${credits}`);
  }

  const rounds = Array.isArray(m.rounds) ? m.rounds : [];
  for (const rd of rounds) {
    const block = formatRoundBlock(rd, locale);
    if (block) lines.push(block);
  }

  return lines.join('\n\n');
}

/**
 * @param {unknown} apiJson
 * @param {{ locale?: 'en' | 'ru' }} [options]
 * @returns {string[]}
 */
export function formatYoteiRotationChunks(apiJson, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'ru';

  if (!apiJson || typeof apiJson !== 'object') {
    return [locale === 'ru' ? 'Пустой ответ API.' : 'Empty API response.'];
  }

  const maps = /** @type {{ maps?: unknown }} */ (apiJson).maps;
  if (!Array.isArray(maps) || maps.length === 0) {
    return [
      locale === 'ru'
        ? 'Нет карт с ротацией Yōtei на текущую неделю.'
        : 'No Yōtei maps with rotation for the current week.',
    ];
  }

  /** @type {string[]} */
  const out = [];
  for (const mapRow of maps) {
    const block = formatMapBlock(mapRow, locale);
    if (!block) continue;
    if (block.length <= DISCORD_CHUNK_MAX) {
      out.push(block);
    } else {
      out.push(...chunkByLength(block, DISCORD_CHUNK_MAX));
    }
  }

  if (out.length === 0) {
    return [locale === 'ru' ? 'Не удалось сформировать текст.' : 'Could not format rotation text.'];
  }
  return out;
}

export { DISCORD_CHUNK_MAX };
