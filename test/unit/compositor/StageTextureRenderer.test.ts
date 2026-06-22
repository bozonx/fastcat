import { afterEach, describe, expect, it, vi } from 'vitest';
import { StageTextureRenderer } from '~/utils/video-editor/compositor/StageTextureRenderer';

describe('StageTextureRenderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('insets and restores the adjustment capture to the project size', async () => {
    const bitmap = { width: 1920, height: 1080 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const lower = { visible: true, __trackId: 'lower' };
    const upper = { visible: true, __trackId: 'upper' };
    const canvas = { width: 1920, height: 1080 };
    const renderer = new StageTextureRenderer({
      app: {
        canvas,
        stage: { children: [lower, upper] },
        renderer: { render: vi.fn() },
      } as any,
      width: 1920,
      height: 1080,
      getTrackById: (trackId) =>
        ({
          layer: trackId === 'lower' ? 0 : 2,
        }) as any,
    });

    await renderer.renderLowerLayersToBitmap(1, { edgeInsetPixels: 2 });

    expect(createImageBitmapMock).toHaveBeenCalledWith(canvas, 2, 2, 1916, 1076, {
      resizeWidth: 1920,
      resizeHeight: 1080,
      resizeQuality: 'low',
    });
    expect(lower.visible).toBe(true);
    expect(upper.visible).toBe(true);
  });

  it('captures a render texture through the renderer canvas without pixel extraction', async () => {
    const bitmap = { width: 640, height: 360 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const canvas = { width: 640, height: 360 };
    const render = vi.fn();
    const renderer = new StageTextureRenderer({
      app: {
        canvas,
        stage: { children: [] },
        renderer: { render },
      } as any,
      width: 640,
      height: 360,
      getTrackById: () => undefined,
    });
    const texture = { width: 640, height: 360 } as any;

    const result = await renderer.renderTextureToBitmap(texture);

    expect(result).toBe(bitmap);
    expect(render).toHaveBeenCalledWith({
      container: expect.objectContaining({
        texture,
      }),
      clear: true,
    });
    expect(createImageBitmapMock).toHaveBeenCalledWith(canvas);
  });
});
