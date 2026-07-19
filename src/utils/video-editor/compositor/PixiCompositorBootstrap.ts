import { createDevLogger } from '~/utils/dev-logger';
import { Application, DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import type { ICanvas } from 'pixi.js';
const log = createDevLogger('PixiCompositorBootstrap');

const PIXI_REQUIRED_SAMPLED_TEXTURES = 32;

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
  if (supportedTextures < PIXI_REQUIRED_SAMPLED_TEXTURES) {
    throw new Error(
      `WebGPU adapter supports ${supportedTextures} sampled fragment textures; ` +
        `Pixi requires ${PIXI_REQUIRED_SAMPLED_TEXTURES}`,
    );
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxSampledTexturesPerShaderStage: PIXI_REQUIRED_SAMPLED_TEXTURES,
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

      await app.init({
        width: options.width,
        height: options.height,
        canvas: canvas as ICanvas,
        backgroundColor: getPixiBackgroundColor(options.bgColor),
        backgroundAlpha: isTransparentBackground(options.bgColor) ? 0 : 1,
        preference: rendererPreference,
        clearBeforeRender: true,
        ...(webGpuContext ? { gpu: webGpuContext } : {}),
      });
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
