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
    const { createPixiCompositorApplication } = await import(
      '~/utils/video-editor/compositor/PixiCompositorBootstrap'
    );

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
        backgroundColor: 'transparent',
        backgroundAlpha: 0,
      }),
    );
  });

  it('initializes opaque compositors with opaque clear enabled', async () => {
    const { createPixiCompositorApplication } = await import(
      '~/utils/video-editor/compositor/PixiCompositorBootstrap'
    );

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
});
