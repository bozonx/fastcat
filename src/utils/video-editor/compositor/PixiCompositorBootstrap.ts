import { Application, DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import type { ICanvas } from 'pixi.js';

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

    try {
      const initPromise = app.init({
        width: options.width,
        height: options.height,
        canvas: canvas as ICanvas,
        backgroundColor: options.bgColor,
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
      return { app, canvas };
    } catch (error) {
      initError = error;
      try {
        app.destroy(true);
      } catch (cleanupError) {
        void cleanupError;
      }

      if (rendererPreference === options.rendererPreferences[0]) {
        console.warn(
          `[VideoCompositor] ${rendererPreference} renderer failed, trying alternate Pixi renderer`,
          error,
        );
      }
    }
  }

  throw initError instanceof Error ? initError : new Error('Failed to initialize Pixi renderer');
}
