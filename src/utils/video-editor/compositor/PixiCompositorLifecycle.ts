import type { Application } from 'pixi.js';
import type { VideoCompositorInitOptions } from '../VideoCompositor';
import { createPixiCompositorApplication } from './PixiCompositorBootstrap';

type PixiRendererPreference = NonNullable<VideoCompositorInitOptions['rendererPreference']>;

export interface PixiCompositorLifecycleInitParams {
  width: number;
  height: number;
  bgColor: string;
  offscreen: boolean;
  externalCanvas?: OffscreenCanvas | HTMLCanvasElement;
  options: VideoCompositorInitOptions;
  onContextLost: (event: Event) => void;
  onContextRestored: () => void;
}

export interface PixiCompositorLifecycleInitResult {
  app: Application;
  canvas: OffscreenCanvas | HTMLCanvasElement;
}

export interface PixiCompositorLifecycleDestroyParams {
  app: Application | null;
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  onContextLost: (event: Event) => void;
  onContextRestored: () => void;
  onDestroyError: (error: unknown) => void;
}

export class PixiCompositorLifecycle {
  public async init(
    params: PixiCompositorLifecycleInitParams,
  ): Promise<PixiCompositorLifecycleInitResult> {
    const preferredRenderer = params.options.rendererPreference ?? 'webgl';
    const rendererPreferences: PixiRendererPreference[] =
      preferredRenderer === 'webgl' ? ['webgl', 'webgpu'] : ['webgpu', 'webgl'];
    const { app, canvas } = await createPixiCompositorApplication({
      width: params.width,
      height: params.height,
      bgColor: params.bgColor,
      offscreen: params.offscreen,
      externalCanvas: params.externalCanvas,
      rendererPreferences,
    });

    this.addContextListeners({
      canvas,
      onContextLost: params.onContextLost,
      onContextRestored: params.onContextRestored,
    });

    app.ticker.stop();

    return { app, canvas };
  }

  public destroy(params: PixiCompositorLifecycleDestroyParams) {
    const { app, canvas } = params;

    this.removeContextListeners({
      canvas,
      onContextLost: params.onContextLost,
      onContextRestored: params.onContextRestored,
    });

    if (!app) return;

    const pixiApp = app as unknown as Record<string, unknown>;
    if (typeof pixiApp._cancelResize !== 'function') {
      pixiApp._cancelResize = () => {};
    }
    if (typeof pixiApp.cancelResize === 'function') {
      pixiApp.cancelResize();
    }

    try {
      app.destroy(
        { removeView: false },
        {
          children: true,
          texture: true,
          textureSource: true,
        },
      );
    } catch (error) {
      params.onDestroyError(error);
    }
  }

  private addContextListeners(params: {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    onContextLost: (event: Event) => void;
    onContextRestored: () => void;
  }) {
    if (!('addEventListener' in params.canvas)) return;

    (params.canvas as HTMLCanvasElement).addEventListener(
      'webglcontextlost',
      params.onContextLost,
      false,
    );
    (params.canvas as HTMLCanvasElement).addEventListener(
      'webglcontextrestored',
      params.onContextRestored,
      false,
    );
  }

  private removeContextListeners(params: {
    canvas: OffscreenCanvas | HTMLCanvasElement | null;
    onContextLost: (event: Event) => void;
    onContextRestored: () => void;
  }) {
    if (!params.canvas || !('removeEventListener' in params.canvas)) return;

    try {
      (params.canvas as HTMLCanvasElement).removeEventListener(
        'webglcontextlost',
        params.onContextLost,
        false,
      );
      (params.canvas as HTMLCanvasElement).removeEventListener(
        'webglcontextrestored',
        params.onContextRestored,
        false,
      );
    } catch {
      // ignore
    }
  }
}
