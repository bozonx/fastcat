/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { initMock, domAdapterSetMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(undefined),
  domAdapterSetMock: vi.fn(),
}));

vi.mock('pixi.js', () => ({
  Application: class {
    init = initMock;
    destroy = vi.fn();
  },
  DOMAdapter: {
    set: domAdapterSetMock,
  },
  WebWorkerAdapter: {},
}));

describe('createPixiCompositorApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initMock.mockResolvedValue(undefined);
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

  it('does not abandon an in-flight renderer initialization', async () => {
    let resolveInit: (() => void) | undefined;
    initMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInit = resolve;
        }),
    );
    const { createPixiCompositorApplication } =
      await import('~/utils/video-editor/compositor/PixiCompositorBootstrap');

    const initialization = createPixiCompositorApplication({
      width: 100,
      height: 50,
      bgColor: '#000',
      offscreen: true,
      externalCanvas: {} as OffscreenCanvas,
      rendererPreferences: ['webgl'],
    });

    await Promise.resolve();
    expect(initMock).toHaveBeenCalledTimes(1);

    resolveInit?.();
    await expect(initialization).resolves.toMatchObject({ app: expect.anything() });
  });

  it('provides Pixi a device with enough sampled texture slots', async () => {
    const device = { destroy: vi.fn() } as unknown as GPUDevice;
    const requestDevice = vi.fn().mockResolvedValue(device);
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          limits: { maxSampledTexturesPerShaderStage: 48 },
          requestDevice,
        }),
      },
    });
    const { createPixiCompositorApplication } =
      await import('~/utils/video-editor/compositor/PixiCompositorBootstrap');

    await createPixiCompositorApplication({
      width: 100,
      height: 50,
      bgColor: '#000',
      offscreen: true,
      externalCanvas: {} as OffscreenCanvas,
      rendererPreferences: ['webgpu'],
    });

    expect(requestDevice).toHaveBeenCalledWith({
      requiredLimits: { maxSampledTexturesPerShaderStage: 32 },
    });
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ gpu: expect.objectContaining({ device }) }),
    );
    vi.unstubAllGlobals();
  });
});
