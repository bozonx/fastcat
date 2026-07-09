/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { initMock, domAdapterSetMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(undefined),
  domAdapterSetMock: vi.fn(),
}));

const textureSourceMock = { defaultOptions: { format: 'bgra8unorm' } };
const navigatorMock = {
  gpu: {
    getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
  },
};

vi.mock('pixi.js', () => ({
  Application: class {
    init = initMock;
    renderer = {
      state: {
        getColorTargets: vi.fn(() => [{ format: 'bgra8unorm' }]),
      },
    };
    destroy = vi.fn();
  },
  DOMAdapter: {
    set: domAdapterSetMock,
    get: () => ({
      getNavigator: () => navigatorMock,
    }),
  },
  TextureSource: textureSourceMock,
  WebWorkerAdapter: {},
}));

describe('createPixiCompositorApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMock.mockResolvedValue(undefined);
    textureSourceMock.defaultOptions.format = 'bgra8unorm';
    navigatorMock.gpu.getPreferredCanvasFormat.mockReturnValue('bgra8unorm');
  });

  it('initializes transparent compositors with alpha clear enabled', async () => {
    const { createPixiCompositorApplication } =
      await import('~/utils/video-editor/compositor/PixiCompositorBootstrap');

    await createPixiCompositorApplication({
      width: 100,
      height: 50,
      bgColor: 'transparent',
      offscreen: true,
      externalCanvas: {} as OffscreenCanvas,
      rendererPreferences: ['webgl'],
    });

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: '#000000',
        backgroundAlpha: 0,
      }),
    );
  });

  it('initializes opaque compositors with opaque clear enabled', async () => {
    const { createPixiCompositorApplication } =
      await import('~/utils/video-editor/compositor/PixiCompositorBootstrap');

    await createPixiCompositorApplication({
      width: 100,
      height: 50,
      bgColor: '#000',
      offscreen: true,
      externalCanvas: {} as OffscreenCanvas,
      rendererPreferences: ['webgl'],
    });

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: '#000',
        backgroundAlpha: 1,
      }),
    );
  });

  it('uses preferred WebGPU canvas format during initialization', async () => {
    navigatorMock.gpu.getPreferredCanvasFormat.mockReturnValue('rgba8unorm');
    const configure = vi.fn();
    const webgpuContext = { configure };
    const canvas = {
      getContext: vi.fn((contextId: string) => (contextId === 'webgpu' ? webgpuContext : null)),
    } as unknown as OffscreenCanvas;
    initMock.mockImplementationOnce(async () => {
      const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
      context.configure({
        device: {} as GPUDevice,
        format: 'bgra8unorm',
        usage: 0,
      });
    });
    const { createPixiCompositorApplication } =
      await import('~/utils/video-editor/compositor/PixiCompositorBootstrap');

    const result = await createPixiCompositorApplication({
      width: 100,
      height: 50,
      bgColor: '#000',
      offscreen: true,
      externalCanvas: canvas,
      rendererPreferences: ['webgpu'],
    });

    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'rgba8unorm',
      }),
    );
    expect(
      (
        result.app as unknown as {
          renderer: { state: { getColorTargets: (state: unknown, count: number) => unknown[] } };
        }
      ).renderer.state.getColorTargets({}, 1),
    ).toEqual([expect.objectContaining({ format: 'rgba8unorm' })]);
    expect(textureSourceMock.defaultOptions.format).toBe('rgba8unorm');
    result.app.destroy();
    expect(textureSourceMock.defaultOptions.format).toBe('bgra8unorm');
  });
});
