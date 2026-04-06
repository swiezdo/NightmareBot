/** @param {string} sourceCommand */
export function appendFlowSuffix(baseId, sourceCommand) {
  const tag = sourceCommand === 'edit-waves' ? 'e' : 's';
  return `${baseId}::${tag}`;
}

/**
 * @returns {{ id: string, flow: 'setup-waves' | 'edit-waves' }}
 */
export function stripFlowSuffix(rawId) {
  const sep = '::';
  const i = rawId.lastIndexOf(sep);
  if (i < 0) return { id: rawId, flow: 'setup-waves' };
  const tag = rawId.slice(i + sep.length);
  const id = rawId.slice(0, i);
  if (tag === 'e') return { id, flow: 'edit-waves' };
  if (tag === 's') return { id, flow: 'setup-waves' };
  return { id: rawId, flow: 'setup-waves' };
}
