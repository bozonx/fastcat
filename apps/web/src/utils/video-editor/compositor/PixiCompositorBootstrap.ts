import { createDevLogger } from '~/utils/dev-logger';
import { Application, DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import type { ICanvas } from 'pixi.js';
const log = createDevLogger('PixiCompositorBootstrap');

const PIXI_REQUIRED_FRAGMENT_BINDINGS = 32;

interface PixiWebGpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
}

export interface PixiCompositorBootstrapOptions {
  width: number;
  height: number;
  bgColor: string;
  offscreen: boolean;
  externalCanvas?: OffscreenCanvas | HTMLCanvasElement;
  rendererPreferences: readonly ('webgl' | 'webgpu')[];
}

/** Guard against a renderer init that never resolves (e.g. a stuck GPU adapter
 * request). Without this the compositor blocks forever; the race rejects after
 * the budget so callers can fall back to the alternate renderer or fail loudly. */
const PIXI_RENDERER_INIT_TIMEOUT_MS = 5000;

export interface PixiCompositorBootstrapResult {
  app: Application;
  canvas: OffscreenCanvas | HTMLCanvasElement;
}

function isTransparentBackground(color: string): boolean {
  const value = color.trim().toLowerCase();
  return value === 'transparent' || value === '#0000' || value === '#00000000';
}

function getPixiBackgroundColor(color: string): string {
  return isTransparentBackground(color) ? '#000000' : color;
}

async function createPixiWebGpuContext(): Promise<PixiWebGpuContext> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is unavailable');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter is unavailable');
  }

  const supportedTextures = adapter.limits.maxSampledTexturesPerShaderStage;
  const supportedSamplers = adapter.limits.maxSamplersPerShaderStage;
  if (
    supportedTextures < PIXI_REQUIRED_FRAGMENT_BINDINGS ||
    supportedSamplers < PIXI_REQUIRED_FRAGMENT_BINDINGS
  ) {
    throw new Error(
      `WebGPU adapter supports ${supportedTextures} sampled textures and ${supportedSamplers} samplers; ` +
        `Pixi requires ${PIXI_REQUIRED_FRAGMENT_BINDINGS} of each`,
    );
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxSampledTexturesPerShaderStage: PIXI_REQUIRED_FRAGMENT_BINDINGS,
      maxSamplersPerShaderStage: PIXI_REQUIRED_FRAGMENT_BINDINGS,
    },
  });
  return { adapter, device };
}

export function createCompositorCanvas(params: {
  width: number;
  height: number;
  offscreen: boolean;
  externalCanvas?: OffscreenCanvas | HTMLCanvasElement;
}): OffscreenCanvas | HTMLCanvasElement {
  if (params.externalCanvas) {
    return params.externalCanvas;
  }

  if (params.offscreen) {
    return new OffscreenCanvas(params.width, params.height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = params.width;
  canvas.height = params.height;
  return canvas;
}

export async function createPixiCompositorApplication(
  options: PixiCompositorBootstrapOptions,
): Promise<PixiCompositorBootstrapResult> {
  if (typeof window === 'undefined') {
    DOMAdapter.set(WebWorkerAdapter);
  }

  const canvas = createCompositorCanvas(options);
  let initError: unknown = null;

  for (const rendererPreference of options.rendererPreferences) {
    const app = new Application();
    let webGpuContext: PixiWebGpuContext | undefined;

    try {
      if (rendererPreference === 'webgpu') {
        webGpuContext = await createPixiWebGpuContext();
      }

      const initPromise = app.init({
        width: options.width,
        height: options.height,
        canvas: canvas as ICanvas,
        backgroundColor: getPixiBackgroundColor(options.bgColor),
        backgroundAlpha: isTransparentBackground(options.bgColor) ? 0 : 1,
        preference: rendererPreference,
        clearBeforeRender: true,
        ...(webGpuContext ? { gpu: webGpuContext } : {}),
      });
      const timeoutMs = PIXI_RENDERER_INIT_TIMEOUT_MS;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(`Pixi ${rendererPreference} renderer init timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
      });

      try {
        await Promise.race([initPromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
      return { app, canvas };
    } catch (error) {
      initError = error;
      try {
        app.destroy(true);
      } catch (cleanupError) {
        void cleanupError;
      }
      webGpuContext?.device.destroy();

      if (rendererPreference === options.rendererPreferences[0]) {
        log.warn(
          `[VideoCompositor] ${rendererPreference} renderer failed, trying alternate Pixi renderer`,
          error,
        );
      }
    }
  }

  throw initError instanceof Error ? initError : new Error('Failed to initialize Pixi renderer');
}
