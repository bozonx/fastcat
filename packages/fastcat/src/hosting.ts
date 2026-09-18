/**
 * Response headers for serving the prebuilt editor.
 *
 * Deliberately free of any runtime (Workers, Node, a CDN rules file): every
 * host — FastCat's own Worker, a self-hosting Worker, an nginx template —
 * computes the same headers from here instead of keeping its own copy.
 */

/** Route of the embeddable editor inside the build. */
export const EMBED_ROUTE_PATH = '/embed';

/** Content-hashed build output that never changes under the same URL. */
export const IMMUTABLE_PATH_PREFIXES: readonly string[] = ['/_nuxt/', '/fonts/'];
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * `none` keeps `/embed` embeddable by any page. `credentialless` additionally
 * lets a host page that is itself cross-origin isolated extend the isolation
 * into the editor, which unlocks `SharedArrayBuffer`; in a non-isolated host it
 * changes nothing visible.
 */
export type EmbedIsolation = 'none' | 'credentialless';

export interface HostingHeadersOptions {
  /**
   * Origins allowed to frame `/embed`. Defaults to any: the SDK handshake
   * (origin pinning plus a per-frame nonce), not the guest list, is the
   * security boundary. A host serving the editor for its own site only should
   * still narrow it.
   */
  frameAncestors?: readonly string[];
  embedIsolation?: EmbedIsolation;
  /**
   * Serve the whole domain as the embed surface, the way `embed.fastcat.video`
   * does: every path — including the scripts and workers `/embed` loads — gets
   * the embed headers, and the standalone editor is not offered at all.
   */
  embedOnly?: boolean;
}

/**
 * The permissions the SDK requests in the iframe's `allow` attribute only take
 * effect if the document grants them too; a delegated permission the frame
 * does not self-grant is dropped silently.
 */
const EMBED_PERMISSIONS_POLICY =
  'fullscreen=(self "*"), clipboard-read=(self), clipboard-write=(self), autoplay=(self)';

/** The standalone editor: isolated, and never framed. */
export const APP_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function isEmbedPath(pathname: string): boolean {
  return pathname === EMBED_ROUTE_PATH || pathname.startsWith(`${EMBED_ROUTE_PATH}/`);
}

export function isImmutablePath(pathname: string): boolean {
  return IMMUTABLE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Headers for the embeddable editor document. */
export function resolveEmbedHeaders(options: HostingHeadersOptions = {}): Record<string, string> {
  const ancestors = options.frameAncestors?.length ? options.frameAncestors.join(' ') : '*';
  return {
    // COOP must stay off: the editor is a frame, and a host page opening it in
    // a popup must not be severed from it.
    'Cross-Origin-Opener-Policy': 'unsafe-none',
    'Cross-Origin-Embedder-Policy':
      options.embedIsolation === 'credentialless' ? 'credentialless' : 'unsafe-none',
    // An isolated host may only frame documents that consent to it.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': `frame-ancestors ${ancestors}`,
    'Permissions-Policy': EMBED_PERMISSIONS_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/**
 * Headers for any path of the build: `/embed` (or everything, with
 * `embedOnly`) gets the embed headers, the rest the standalone ones, plus
 * long-lived caching for hashed assets.
 */
export function resolveHostingHeaders(
  pathname: string,
  options: HostingHeadersOptions = {},
): Record<string, string> {
  const headers =
    options.embedOnly || isEmbedPath(pathname) ? resolveEmbedHeaders(options) : { ...APP_HEADERS };
  if (isImmutablePath(pathname)) headers['Cache-Control'] = IMMUTABLE_CACHE_CONTROL;
  return headers;
}
