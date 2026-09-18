/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  APP_HEADERS,
  IMMUTABLE_CACHE_CONTROL,
  isEmbedPath,
  resolveEmbedHeaders,
  resolveHostingHeaders,
} from '../../../../../packages/fastcat/src/hosting';

describe('@bozonx/fastcat/hosting', () => {
  it('recognises the embed route and nothing that merely starts with it', () => {
    expect(isEmbedPath('/embed')).toBe(true);
    expect(isEmbedPath('/embed/')).toBe(true);
    expect(isEmbedPath('/embedded')).toBe(false);
    expect(isEmbedPath('/')).toBe(false);
  });

  it('keeps the embed document embeddable anywhere and non-isolated by default', () => {
    const headers = resolveEmbedHeaders();
    expect(headers['Cross-Origin-Opener-Policy']).toBe('unsafe-none');
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('unsafe-none');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(headers['Content-Security-Policy']).toBe('frame-ancestors *');
  });

  it('narrows frame ancestors and opts into credentialless isolation on request', () => {
    const headers = resolveEmbedHeaders({
      frameAncestors: ['https://a.example', 'https://b.example'],
      embedIsolation: 'credentialless',
    });
    expect(headers['Content-Security-Policy']).toBe(
      'frame-ancestors https://a.example https://b.example',
    );
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  it('serves the standalone editor isolated and unframeable', () => {
    const headers = resolveHostingHeaders('/editor/1');
    expect(headers).toEqual(APP_HEADERS);
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
  });

  it('gives every path the embed headers in embed-only mode', () => {
    const headers = resolveHostingHeaders('/_nuxt/entry.js', {
      embedOnly: true,
      embedIsolation: 'credentialless',
    });
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('credentialless');
    expect(headers['Cache-Control']).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it('does not let callers mutate the shared standalone headers', () => {
    resolveHostingHeaders('/_nuxt/entry.js')['X-Test'] = '1';
    expect(APP_HEADERS['X-Test']).toBeUndefined();
    expect(APP_HEADERS['Cache-Control']).toBeUndefined();
  });
});
