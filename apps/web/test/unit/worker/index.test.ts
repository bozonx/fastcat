/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import worker, {
  isEmbedRequest,
  resolveTargetRequest,
  resolveResponseHeaders,
  ISOLATION_HEADERS,
  EMBED_HEADERS,
  IMMUTABLE_CACHE_CONTROL,
} from '../../../../worker/index';

describe('Cloudflare Worker (worker/index.ts)', () => {
  describe('isEmbedRequest', () => {
    it('identifies requests to embed.fastcat.video as embed requests', () => {
      expect(isEmbedRequest(new URL('https://embed.fastcat.video/'))).toBe(true);
      expect(isEmbedRequest(new URL('https://embed.fastcat.video/foo?bar=1'))).toBe(true);
    });

    it('identifies /embed paths as embed requests on any host', () => {
      expect(isEmbedRequest(new URL('https://app.fastcat.video/embed'))).toBe(true);
      expect(isEmbedRequest(new URL('https://app.fastcat.video/embed/'))).toBe(true);
      expect(isEmbedRequest(new URL('https://app.fastcat.video/embed/player'))).toBe(true);
    });

    it('identifies standard app requests as non-embed requests', () => {
      expect(isEmbedRequest(new URL('https://app.fastcat.video/'))).toBe(false);
      expect(isEmbedRequest(new URL('https://app.fastcat.video/editor/123'))).toBe(false);
      expect(isEmbedRequest(new URL('https://app.fastcat.video/_nuxt/entry.js'))).toBe(false);
    });
  });

  describe('resolveTargetRequest', () => {
    it('rewrites embed.fastcat.video root request to /embed', () => {
      const original = new Request('https://embed.fastcat.video/');
      const target = resolveTargetRequest(original, new URL(original.url));

      expect(target.url).toBe('https://embed.fastcat.video/embed');
    });

    it('keeps other paths on embed.fastcat.video unchanged', () => {
      const original = new Request('https://embed.fastcat.video/_nuxt/entry.js');
      const target = resolveTargetRequest(original, new URL(original.url));

      expect(target.url).toBe('https://embed.fastcat.video/_nuxt/entry.js');
    });

    it('keeps app.fastcat.video root request unchanged', () => {
      const original = new Request('https://app.fastcat.video/');
      const target = resolveTargetRequest(original, new URL(original.url));

      expect(target.url).toBe('https://app.fastcat.video/');
    });
  });

  describe('resolveResponseHeaders', () => {
    it('attaches isolation headers for app requests', () => {
      const source = new Headers({ 'content-type': 'text/html' });
      const url = new URL('https://app.fastcat.video/');
      const headers = resolveResponseHeaders(source, url, false);

      expect(headers.get('Cross-Origin-Opener-Policy')).toBe(
        ISOLATION_HEADERS['Cross-Origin-Opener-Policy'],
      );
      expect(headers.get('Cross-Origin-Embedder-Policy')).toBe(
        ISOLATION_HEADERS['Cross-Origin-Embedder-Policy'],
      );
      expect(headers.get('Cross-Origin-Resource-Policy')).toBe(
        ISOLATION_HEADERS['Cross-Origin-Resource-Policy'],
      );
      expect(headers.get('content-type')).toBe('text/html');
    });

    it('attaches embed headers for embed requests', () => {
      const source = new Headers({ 'content-type': 'text/html' });
      const url = new URL('https://embed.fastcat.video/');
      const headers = resolveResponseHeaders(source, url, true);

      expect(headers.get('Cross-Origin-Opener-Policy')).toBe(
        EMBED_HEADERS['Cross-Origin-Opener-Policy'],
      );
      expect(headers.get('Cross-Origin-Embedder-Policy')).toBe(
        EMBED_HEADERS['Cross-Origin-Embedder-Policy'],
      );
      expect(headers.get('Cross-Origin-Resource-Policy')).toBe(
        EMBED_HEADERS['Cross-Origin-Resource-Policy'],
      );
      expect(headers.get('Access-Control-Allow-Origin')).toBe(
        EMBED_HEADERS['Access-Control-Allow-Origin'],
      );
    });

    it('adds immutable cache control for /_nuxt/ and /fonts/ assets', () => {
      const source = new Headers({ 'content-type': 'application/javascript' });
      const nuxtAsset = new URL('https://app.fastcat.video/_nuxt/bundle.js');
      const fontAsset = new URL('https://app.fastcat.video/fonts/inter.woff2');
      const htmlAsset = new URL('https://app.fastcat.video/index.html');

      const nuxtHeaders = resolveResponseHeaders(source, nuxtAsset, false);
      expect(nuxtHeaders.get('Cache-Control')).toBe(IMMUTABLE_CACHE_CONTROL);

      const fontHeaders = resolveResponseHeaders(source, fontAsset, false);
      expect(fontHeaders.get('Cache-Control')).toBe(IMMUTABLE_CACHE_CONTROL);

      const htmlHeaders = resolveResponseHeaders(source, htmlAsset, false);
      expect(htmlHeaders.get('Cache-Control')).toBeNull();
    });
  });

  describe('fetch handler', () => {
    it('handles app requests and sets isolation headers', async () => {
      const mockEnv = {
        ASSETS: {
          fetch: vi.fn().mockResolvedValue(
            new Response('<html>App</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          ),
        },
      };

      const request = new Request('https://app.fastcat.video/');
      const response = await worker.fetch(request, mockEnv);

      expect(mockEnv.ASSETS.fetch).toHaveBeenCalledTimes(1);
      const passedRequest = mockEnv.ASSETS.fetch.mock.calls[0][0] as Request;
      expect(passedRequest.url).toBe('https://app.fastcat.video/');

      expect(response.status).toBe(200);
      expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
      expect(await response.text()).toBe('<html>App</html>');
    });

    it('handles embed root requests, rewrites to /embed and sets embed headers', async () => {
      const mockEnv = {
        ASSETS: {
          fetch: vi.fn().mockResolvedValue(
            new Response('<html>Embed</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          ),
        },
      };

      const request = new Request('https://embed.fastcat.video/');
      const response = await worker.fetch(request, mockEnv);

      expect(mockEnv.ASSETS.fetch).toHaveBeenCalledTimes(1);
      const passedRequest = mockEnv.ASSETS.fetch.mock.calls[0][0] as Request;
      expect(passedRequest.url).toBe('https://embed.fastcat.video/embed');

      expect(response.status).toBe(200);
      expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('unsafe-none');
      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('unsafe-none');
      expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(await response.text()).toBe('<html>Embed</html>');
    });
  });
});
