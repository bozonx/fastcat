/**
 * Single source of truth for generating identifiers.
 *
 * Before this module the `crypto.randomUUID() ?? Math.random()` pattern was
 * copy-pasted into a dozen stores/composables with subtly different fallbacks,
 * and every test that needed deterministic IDs had to stub `crypto` globally.
 * Import {@link genUuid} / {@link randomToken} and stub *this* module instead.
 */

/**
 * A globally-unique identifier. Uses `crypto.randomUUID()` when available and
 * falls back to a timestamp + random suffix in environments that lack it.
 *
 * The fallback keeps a `-` separator so callers that do `genUuid().split('-')`
 * still receive a non-empty leading segment.
 */
export function genUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * A short, lower-case base36 random token of the requested length (default 8).
 * Intended for non-security-sensitive uses such as temp-file suffixes where a
 * full UUID would be overkill.
 */
export function randomToken(length = 8): string {
  let out = '';
  while (out.length < length) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, length);
}

/** Convenience for `${prefix}${genUuid()}` to keep call sites terse. */
export function genPrefixedId(prefix: string): string {
  return `${prefix}${genUuid()}`;
}
