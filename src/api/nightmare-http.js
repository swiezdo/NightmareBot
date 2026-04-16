/**
 * @param {Response} res
 */
export async function readJsonOrNull(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * @param {Response} res
 * @param {number} [rawLimit]
 */
export async function readJsonOrParseError(res, rawLimit = 500) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { _parse_error: true, _raw: text.slice(0, rawLimit) };
  }
}

/**
 * @param {unknown} e
 */
export function isTimeoutOrAbortError(e) {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}
