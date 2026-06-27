import type { Page } from '@playwright/test';

/**
 * Bridge for driving the web video engine from Playwright tests.
 *
 * Instead of dynamic imports inside page.evaluate (which fail because Vite
 * aliases like ~/ are not resolvable in the browser runtime), we navigate to
 * /test/parity — a Nuxt page that imports VideoCompositor at build time and
 * exposes `window.__parityEngine.renderFrames()`.
 */

/** Result of a single frame render + hash computation. */
export interface WebFrameResult {
  hash: string;
  /** 2x2 mean-color signature (24 hex chars). Empty string on render error. */
  colorSig: string;
  width: number;
  height: number;
  error?: string;
}

/** Scene JSON as parsed from shared/scenes/. */
export interface WebSceneData {
  scene: Record<string, unknown>;
  sample_times_sec: number[];
}

/**
 * Mapping from relative media paths (as used in scene layers) to OPFS paths
 * where the fixture bytes have been pre-loaded.
 */
export interface MediaPathMapping {
  [relativePath: string]: string;
}

interface ParityRenderRequest {
  scene: {
    layers: Array<Record<string, unknown>>;
    width: number;
    height: number;
  };
  sampleTimesSec: number[];
  mediaMapping: Record<string, string>;
}

/**
 * Navigate to the parity test page and render frames for a scene.
 * The page exposes `window.__parityEngine.renderFrames()` which handles
 * VideoCompositor init, clip loading, rendering, and hash computation
 * entirely inside the browser context with proper module resolution.
 */
export async function renderWebFrames(
  page: Page,
  sceneData: WebSceneData,
  mediaMapping: MediaPathMapping,
): Promise<WebFrameResult[]> {
  // Navigate to the parity test page if not already there.
  const currentUrl = page.url();
  if (!currentUrl.includes('/test/parity')) {
    await page.goto('/test/parity');
  }

  // Wait for the parity engine to be exposed on window.
  await page.waitForFunction(() => {
    return (
      typeof (window as unknown as { __parityEngine?: unknown }).__parityEngine !== 'undefined'
    );
  });

  const scene = sceneData.scene as {
    layers: Array<Record<string, unknown>>;
    width: number;
    height: number;
  };

  const request: ParityRenderRequest = {
    scene,
    sampleTimesSec: sceneData.sample_times_sec,
    mediaMapping,
  };

  return await page.evaluate(async (req: ParityRenderRequest) => {
    const engine = (
      window as unknown as {
        __parityEngine: {
          renderFrames: (req: ParityRenderRequest) => Promise<WebFrameResult[]>;
        };
      }
    ).__parityEngine;

    return engine.renderFrames(req);
  }, request);
}
