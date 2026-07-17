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
 * `available` is a *functional* verdict, not merely "an adapter exists": it
 * also clears a tiny texture to a non-trivial colour and reads it back, so an
 * adapter whose GPU process is present but cannot actually render (e.g. a
 * SwiftShader build whose instance dies on submit, producing black frames) is
 * reported as unavailable. This keeps WebGPU-gated specs from false-failing in
 * a GPU-less environment instead of skipping cleanly.
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

      // Functional render check: clear a 2×2 canvas to red and read it back. An
      // adapter can exist while the underlying GPU instance is dead (Dawn raises
      // "A valid external Instance reference no longer exists" on submit, and
      // the readback comes back black) — treat that as unavailable so render-
      // dependent specs skip rather than false-fail.
      const device = await adapter.requestDevice();
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext('webgpu');
        if (!ctx) {
          return {
            available: false,
            reason: 'getContext("webgpu") returned null',
            vendor: info?.vendor,
            architecture: info?.architecture,
          };
        }
        ctx.configure({
          device,
          format: navigator.gpu.getPreferredCanvasFormat(),
          alphaMode: 'opaque',
        });
        const encoder = device.createCommandEncoder();
        encoder
          .beginRenderPass({
            colorAttachments: [
              {
                view: ctx.getCurrentTexture().createView(),
                clearValue: { r: 0.9, g: 0.1, b: 0.2, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          })
          .end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();

        const tmp = document.createElement('canvas');
        tmp.width = 2;
        tmp.height = 2;
        const tmpCtx = tmp.getContext('2d');
        if (!tmpCtx) {
          return {
            available: false,
            reason: '2d readback context unavailable',
            vendor: info?.vendor,
            architecture: info?.architecture,
          };
        }
        tmpCtx.drawImage(canvas, 0, 0);
        const px = tmpCtx.getImageData(0, 0, 1, 1).data;
        // The cleared canvas must carry the clear colour, not be black — a dead
        // instance silently yields all-zero pixels.
        if (px[0]! < 100) {
          return {
            available: false,
            reason: `WebGPU render readback was black (r=${px[0]}); GPU pipeline unusable`,
            vendor: info?.vendor,
            architecture: info?.architecture,
          };
        }
      } finally {
        device.destroy();
      }

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
