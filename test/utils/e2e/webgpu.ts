import type { Page } from '@playwright/test';

export interface WebGpuAdapterInfo {
  available: boolean;
  vendor?: string;
  architecture?: string;
  description?: string;
  reason?: string;
}

/**
 * Probes WebGPU availability from the page context (the same context the
 * compositor workers run in). Requires the chromium `--enable-unsafe-webgpu`
 * launch flag (configured in playwright.config.ts) and a secure context — the
 * app's http://localhost origin qualifies, but `about:blank` does NOT expose
 * `navigator.gpu`, so always probe after `page.goto('/')`.
 *
 * In headless/CI the adapter is the bundled SwiftShader software backend
 * (correct, but slow). Use it for correctness assertions, not perf.
 */
export async function probeWebGpu(page: Page): Promise<WebGpuAdapterInfo> {
  return await page.evaluate(async () => {
    if (!('gpu' in navigator) || !navigator.gpu) {
      return { available: false, reason: 'navigator.gpu is undefined' };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return { available: false, reason: 'requestAdapter() returned null' };
      }

      const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
      return {
        available: true,
        vendor: info?.vendor,
        architecture: info?.architecture,
        description: info?.description,
      };
    } catch (error) {
      return { available: false, reason: String(error) };
    }
  });
}
