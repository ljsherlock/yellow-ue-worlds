/**
 * Compact, sortable-enough id for traces and spans.
 * Not cryptographically random — we're not protecting secrets, just
 * distinguishing concurrent flows.
 */
export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 9);
  return `${ts}-${rand}`;
}
