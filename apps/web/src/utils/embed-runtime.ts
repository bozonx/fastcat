/** Route owning the embeddable editor. Kept here so non-page code can branch on
 *  it without importing the router. */
export const EMBED_ROUTE_PATH = '/embed';

/**
 * True when the current document is the embeddable build running inside a host
 * page's iframe. Cross-origin isolation is unavailable there (it would require
 * every embedding site to adopt COOP/COEP), so capability gates that treat a
 * missing `SharedArrayBuffer` as fatal must relax in this mode.
 */
export function isEmbedRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === EMBED_ROUTE_PATH || path.endsWith(EMBED_ROUTE_PATH);
}
