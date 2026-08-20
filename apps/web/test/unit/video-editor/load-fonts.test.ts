/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VENDORED_FONTS } from '~/utils/video-editor/font-manifest';
import { __resetFontsLoadedForTesting, loadFonts } from '~/utils/video-editor/load-fonts';

class MockFontFace {
  family: string;
  source: string;
  descriptors: Record<string, string> | undefined;

  constructor(family: string, source: string, descriptors?: Record<string, string>) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }

  load = vi.fn().mockResolvedValue(this);
}

describe('loadFonts', () => {
  const originalDocument = globalThis.document;
  const originalFontFace = globalThis.FontFace;
  const originalFonts = (globalThis as { fonts?: FontFaceSet }).fonts;

  beforeEach(() => {
    __resetFontsLoadedForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetFontsLoadedForTesting();
    globalThis.document = originalDocument;
    globalThis.FontFace = originalFontFace;
    (globalThis as { fonts?: FontFaceSet }).fonts = originalFonts;
  });

  it('registers every vendored face into document.fonts from a same-origin URL', async () => {
    const add = vi.fn();
    globalThis.document = { fonts: { add } } as unknown as Document;
    globalThis.FontFace = MockFontFace as unknown as typeof FontFace;

    await loadFonts();

    expect(add).toHaveBeenCalledTimes(VENDORED_FONTS.length);
    const first = add.mock.calls[0]?.[0] as MockFontFace;
    expect(first.family).toBe(VENDORED_FONTS[0]?.family);
    // Source must be a same-origin url(...) — no cross-origin CDN fetch (COEP-safe).
    expect(first.source).toBe(`url(${VENDORED_FONTS[0]?.url})`);
    expect(first.source).not.toContain('http');
    expect(first.descriptors).toMatchObject({
      weight: VENDORED_FONTS[0]?.weight,
      style: VENDORED_FONTS[0]?.style,
    });
    // Every registered face is actually loaded.
    expect(first.load).toHaveBeenCalled();
  });

  it('falls back to the worker-global FontFaceSet when there is no document', async () => {
    const add = vi.fn();
    globalThis.document = undefined as unknown as Document;
    (globalThis as { fonts?: FontFaceSet }).fonts = { add } as unknown as FontFaceSet;
    globalThis.FontFace = MockFontFace as unknown as typeof FontFace;

    await loadFonts();

    expect(add).toHaveBeenCalledTimes(VENDORED_FONTS.length);
  });

  it('is idempotent across calls (loads once)', async () => {
    const add = vi.fn();
    globalThis.document = { fonts: { add } } as unknown as Document;
    globalThis.FontFace = MockFontFace as unknown as typeof FontFace;

    await loadFonts();
    await loadFonts();

    expect(add).toHaveBeenCalledTimes(VENDORED_FONTS.length);
  });
});
