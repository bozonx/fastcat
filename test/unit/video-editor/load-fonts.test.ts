/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetFontsLoadedForTesting, loadFonts } from '~/utils/video-editor/load-fonts';

class MockFontFace {
  family: string;
  source: string;

  constructor(family: string, source: string) {
    this.family = family;
    this.source = source;
  }

  load = vi.fn().mockResolvedValue(this);
}

describe('loadFonts', () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalFontFace = globalThis.FontFace;
  const originalFonts = (globalThis as { fonts?: FontFaceSet }).fonts;

  beforeEach(() => {
    __resetFontsLoadedForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetFontsLoadedForTesting();
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    globalThis.FontFace = originalFontFace;
    (globalThis as { fonts?: FontFaceSet }).fonts = originalFonts;
  });

  it('uses document.fonts when loading fonts in the main thread', async () => {
    const add = vi.fn();
    globalThis.document = {
      fonts: { add },
    } as unknown as Document;
    globalThis.FontFace = MockFontFace as unknown as typeof FontFace;
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(`
        @font-face {
          font-family: 'Inter';
          src: url(https://example.test/inter.woff2) format('woff2');
        }
      `),
    }) as unknown as typeof fetch;

    await loadFonts();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toMatchObject({
      family: 'Inter',
      source: 'url(https://example.test/inter.woff2)',
    });
  });
});
