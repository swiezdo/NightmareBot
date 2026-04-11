import { isUserInSetupAllowlistTable } from '../db/setup-allowlist.js';

/**
 * @param {string | undefined} raw
 * @returns {Set<string>}
 */
export function parseManagerUserIds(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  const s = String(raw).trim();
  try {
    if (s.startsWith('[')) {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return new Set(arr.map((x) => String(x)));
    }
  } catch {
    /* fall through */
  }
  return new Set(
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

/**
 * ID из `ALLOWED_USER_IDS` — могут /whitelist-* и всегда setup/edit/bulk.
 *
 * @param {string} userId
 */
export function isWhitelistManager(userId) {
  const managers = parseManagerUserIds(process.env.ALLOWED_USER_IDS);
  return managers.has(String(userId));
}

/**
 * Менеджер из env или запись в `waves_setup_allowlist`.
 *
 * @param {string} userId
 */
export function isAllowedForSetupCommands(userId) {
  return isWhitelistManager(userId) || isUserInSetupAllowlistTable(String(userId));
}
