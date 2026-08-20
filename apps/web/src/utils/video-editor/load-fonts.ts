import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import { VENDORED_FONTS } from './font-manifest';

const log = createDevLogger('load-fonts');
let fontsLoaded = false;

function getAvailableFontSet(): FontFaceSet | null {
  if (typeof document !== 'undefined' && document.fonts) {
    return document.fonts;
  }

  return (globalThis as { fonts?: FontFaceSet }).fonts ?? null;
}

/**
 * Register the text-tool fonts into the current realm's `FontFaceSet` (main
 * thread + the video-core / export workers, each of which renders text on its
 * own canvas). Faces are loaded from SAME-ORIGIN `/fonts/*.woff2` files vendored
 * from `@fontsource` (see scripts/vendor-fonts.mjs) — a cross-origin CDN fetch
 * would be blocked once the build ships COOP/COEP `require-corp`.
 */
export async function loadFonts(): Promise<void> {
  if (fontsLoaded) return;
  fontsLoaded = true;

  if (isTauriRuntime()) {
    return;
  }

  try {
    const fontSet = getAvailableFontSet();
    if (!fontSet || typeof FontFace === 'undefined') return;

    await Promise.allSettled(
      VENDORED_FONTS.map(async ({ family, url, weight, style, unicodeRange }) => {
        const descriptors: FontFaceDescriptors = { weight, style };
        if (unicodeRange) descriptors.unicodeRange = unicodeRange;
        const fontFace = new FontFace(family, `url(${url})`, descriptors);
        fontSet.add(fontFace);
        await fontFace.load();
      }),
    );
  } catch (e) {
    log.warn('[FontLoader] Font loading failed:', e);
  }
}

/**
 * Test-only helper: clear the "fonts already loaded" latch so a spec can assert
 * the load path runs again.
 */
export function __resetFontsLoadedForTesting(): void {
  fontsLoaded = false;
}
