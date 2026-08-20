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

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export const EMBED_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'unsafe-none',
  'Cross-Origin-Embedder-Policy': 'unsafe-none',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
};

export const IMMUTABLE_PREFIXES = ['/_nuxt/', '/fonts/'];
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function isEmbedRequest(url: URL): boolean {
  return (
    url.hostname === 'embed.fastcat.video' ||
    url.pathname === '/embed' ||
    url.pathname.startsWith('/embed/')
  );
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

  if (IMMUTABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
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
