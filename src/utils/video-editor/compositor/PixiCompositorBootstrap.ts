import { createDevLogger } from '~/utils/dev-logger';
import { Application, DOMAdapter, TextureSource, WebWorkerAdapter } from 'pixi.js';
import type { ICanvas, TEXTURE_FORMATS } from 'pixi.js';
const log = createDevLogger('PixiCompositorBootstrap');

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

function getPreferredWebGpuCanvasFormat(): TEXTURE_FORMATS | null {
  const gpu = DOMAdapter.get().getNavigator?.().gpu ?? globalThis.navigator?.gpu;
  const preferred = gpu?.getPreferredCanvasFormat?.();
  return preferred === 'rgba8unorm' || preferred === 'bgra8unorm' ? preferred : null;
}

function installPreferredWebGpuCanvasFormatShim(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  preferredFormat: TEXTURE_FORMATS | null,
): (() => void) | null {
  if (!preferredFormat || preferredFormat === 'bgra8unorm') {
    return null;
  }

  const originalGetContext = canvas.getContext.bind(canvas) as typeof canvas.getContext;
  const configuredContexts = new WeakSet<object>();

  try {
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: ((contextId: string, options?: unknown) => {
        const context = originalGetContext(contextId as never, options as never);
        if (contextId !== 'webgpu' || !context || configuredContexts.has(context as object)) {
          return context;
        }

        const webGpuContext = context as unknown as GPUCanvasContext;
        const originalConfigure = webGpuContext.configure.bind(webGpuContext);
        Object.defineProperty(webGpuContext, 'configure', {
          configurable: true,
          value: (configuration: GPUCanvasConfiguration) => {
            originalConfigure({
              ...configuration,
              format:
                configuration.format === 'bgra8unorm'
                  ? (preferredFormat as GPUTextureFormat)
                  : configuration.format,
            });
          },
        });
        configuredContexts.add(webGpuContext);
        return webGpuContext;
      }) as typeof canvas.getContext,
    });
  } catch {
    return null;
  }

  return () => {
    try {
      Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: originalGetContext,
      });
    } catch {
      // ignore
    }
  };
}

function installPixiWebGpuPreferredFormatPatch(
  app: Application,
  preferredFormat: TEXTURE_FORMATS | null,
  previousTextureSourceFormat: TEXTURE_FORMATS,
): void {
  if (preferredFormat !== 'rgba8unorm') {
    return;
  }

  const renderer = app.renderer as unknown as {
    state?: {
      getColorTargets?: (state: unknown, count: number) => Array<Record<string, unknown>>;
    };
  };
  const stateSystem = renderer.state;
  const originalGetColorTargets = stateSystem?.getColorTargets?.bind(stateSystem);
  if (originalGetColorTargets && stateSystem) {
    stateSystem.getColorTargets = (state, count) =>
      originalGetColorTargets(state, count).map((target) => ({
        ...target,
        format: preferredFormat,
      }));
  }

  const originalDestroy = app.destroy.bind(app);
  let restored = false;
  app.destroy = ((...args: Parameters<Application['destroy']>) => {
    try {
      return originalDestroy(...args);
    } finally {
      if (!restored) {
        TextureSource.defaultOptions.format = previousTextureSourceFormat;
        restored = true;
      }
    }
  }) as Application['destroy'];
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
    const preferredWebGpuFormat =
      rendererPreference === 'webgpu' ? getPreferredWebGpuCanvasFormat() : null;
    const restoreCanvasGetContext = installPreferredWebGpuCanvasFormatShim(
      canvas,
      preferredWebGpuFormat,
    );
    const previousTextureSourceFormat = TextureSource.defaultOptions.format ?? 'bgra8unorm';
    let shouldRestoreTextureSourceFormat = true;
    if (preferredWebGpuFormat) {
      TextureSource.defaultOptions.format = preferredWebGpuFormat;
    }

    try {
      const initPromise = app.init({
        width: options.width,
        height: options.height,
        canvas: canvas as ICanvas,
        backgroundColor: getPixiBackgroundColor(options.bgColor),
        backgroundAlpha: isTransparentBackground(options.bgColor) ? 0 : 1,
        preference: rendererPreference,
        clearBeforeRender: true,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutMs = 5000;
        setTimeout(
          () =>
            reject(
              new Error(`Pixi ${rendererPreference} renderer init timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
      });

      await Promise.race([initPromise, timeoutPromise]);
      installPixiWebGpuPreferredFormatPatch(
        app,
        preferredWebGpuFormat,
        previousTextureSourceFormat,
      );
      shouldRestoreTextureSourceFormat = preferredWebGpuFormat !== 'rgba8unorm';
      return { app, canvas };
    } catch (error) {
      initError = error;
      try {
        app.destroy(true);
      } catch (cleanupError) {
        void cleanupError;
      }

      if (rendererPreference === options.rendererPreferences[0]) {
        log.warn(
          `[VideoCompositor] ${rendererPreference} renderer failed, trying alternate Pixi renderer`,
          error,
        );
      }
    } finally {
      if (shouldRestoreTextureSourceFormat) {
        TextureSource.defaultOptions.format = previousTextureSourceFormat;
      }
      restoreCanvasGetContext?.();
    }
  }

  throw initError instanceof Error ? initError : new Error('Failed to initialize Pixi renderer');
}
