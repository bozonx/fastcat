// Cloudflare Worker entry: serves the pre-built static SPA from the ASSETS
// binding and stamps appropriate isolation / embed headers on every response.
//
// Dual-domain architecture:
// 1. `app.fastcat.video` (Standalone app):
//    COOP/COEP make the document cross-origin isolated, which is required for
//    `SharedArrayBuffer` (the coordinated OPFS I/O budget, WASM threads, etc.).
// 2. `embed.fastcat.video` (and `/embed` routes):
//    Opts OUT of isolation (`unsafe-none`) so third-party host pages can embed
//    the editor without adopting COOP/COEP. Root requests to `embed.fastcat.video/`
//    are transparently routed to the `/embed` asset.
//
// The headers themselves (including `frame-ancestors` and `Permissions-Policy`,
// which a Worker does not pick up from `public/_headers`) come from
// `packages/fastcat/src/hosting.ts`, the same code self-hosting deployments use.

import {
  APP_HEADERS,
  IMMUTABLE_CACHE_CONTROL,
  isEmbedPath,
  isImmutablePath,
  resolveEmbedHeaders,
} from '../../packages/fastcat/src/hosting';

export { IMMUTABLE_CACHE_CONTROL };

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Headers come from `@bozonx/fastcat/hosting`, shared with self-hosting deployments. */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = APP_HEADERS;
export const EMBED_HEADERS: Readonly<Record<string, string>> = resolveEmbedHeaders();

export function isEmbedRequest(url: URL): boolean {
  return url.hostname === 'embed.fastcat.video' || isEmbedPath(url.pathname);
}

export function resolveTargetRequest(request: Request, url: URL): Request {
  if (url.hostname === 'embed.fastcat.video' && url.pathname === '/') {
    const embedUrl = new URL('/embed', request.url);
    return new Request(embedUrl.toString(), request);
  }
  return request;
}

export function resolveResponseHeaders(
  sourceHeaders: Headers,
  url: URL,
  isEmbed: boolean,
): Headers {
  const headers = new Headers(sourceHeaders);
  const activeHeaders = isEmbed ? EMBED_HEADERS : ISOLATION_HEADERS;

  for (const [name, value] of Object.entries(activeHeaders)) {
    headers.set(name, value);
  }

  if (isImmutablePath(url.pathname)) {
    headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  }

  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isEmbed = isEmbedRequest(url);
    const targetRequest = resolveTargetRequest(request, url);

    const assetResponse = await env.ASSETS.fetch(targetRequest);

    const headers = resolveResponseHeaders(assetResponse.headers, url, isEmbed);

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
