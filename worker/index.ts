// Cloudflare Worker entry: serves the pre-built static SPA from the ASSETS
// binding and stamps cross-origin isolation headers on every response.
//
// COOP/COEP make the document cross-origin isolated, which is required for
// `SharedArrayBuffer` (the coordinated OPFS I/O budget, WASM threads, etc.).
// COEP `require-corp` additionally demands that every subresource carry CORP or
// CORS — all of FastCat's subresources are same-origin (fonts vendored under
// /fonts/, icons inlined into the bundle), so a same-origin CORP on every
// response satisfies it without breaking anything.
//
// Cloudflare Workers ignore `public/_headers` (that's a Pages/Netlify feature),
// so this is the single source of truth for isolation headers on the Worker
// deploy target. Keep it in sync with `public/_headers` and the dev/preview
// middleware in `nuxt.config.ts`.

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const IMMUTABLE_PREFIXES = ['/_nuxt/', '/fonts/'];
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const assetResponse = await env.ASSETS.fetch(request);

    // Response headers from the ASSETS binding are immutable; clone into a
    // mutable Response so we can attach the isolation + cache headers.
    const headers = new Headers(assetResponse.headers);
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
      headers.set(name, value);
    }

    const { pathname } = new URL(request.url);
    if (IMMUTABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
