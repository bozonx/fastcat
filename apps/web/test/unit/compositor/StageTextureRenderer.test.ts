import { afterEach, describe, expect, it, vi } from 'vitest';
import { RendererType } from 'pixi.js';
import { StageTextureRenderer } from '~/utils/video-editor/compositor/StageTextureRenderer';

describe('StageTextureRenderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubImageData() {
    class TestImageData {
      constructor(
        public readonly data: Uint8ClampedArray,
        public readonly width: number,
        public readonly height: number,
      ) {}
    }

    vi.stubGlobal('ImageData', TestImageData);
    return TestImageData;
  }

  it('insets and restores the adjustment capture to the project size', async () => {
    const TestImageData = stubImageData();
    const bitmap = { width: 1920, height: 1080 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const lower = { visible: true, __trackId: 'lower' };
    const upper = { visible: true, __trackId: 'upper' };
    const pixels = new Uint8ClampedArray(1920 * 1080 * 4);
    const extractPixels = vi.fn(() => ({ pixels, width: 1920, height: 1080 }));
    const renderer = new StageTextureRenderer({
      app: {
        stage: { children: [lower, upper] },
        renderer: { render: vi.fn(), extract: { pixels: extractPixels } },
      } as any,
      width: 1920,
      height: 1080,
      getTrackById: (trackId) =>
        ({
          layer: trackId === 'lower' ? 0 : 2,
        }) as any,
    });

    await renderer.renderLowerLayersToBitmap(1, { edgeInsetPixels: 2 });

    expect(extractPixels).toHaveBeenCalledOnce();
    const [imageData, sx, sy, sw, sh, options] = createImageBitmapMock.mock.calls[0] ?? [];
    expect(imageData).toBeInstanceOf(TestImageData);
    expect([sx, sy, sw, sh]).toEqual([2, 2, 1916, 1076]);
    expect(options).toEqual({
      resizeWidth: 1920,
      resizeHeight: 1080,
      resizeQuality: 'low',
    });
    expect(lower.visible).toBe(true);
    expect(upper.visible).toBe(true);
  });

  it('captures a render texture through pixel extraction', async () => {
    const TestImageData = stubImageData();
    const bitmap = { width: 640, height: 360 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const render = vi.fn();
    const pixels = new Uint8ClampedArray(640 * 360 * 4);
    const extractPixels = vi.fn(() => ({ pixels, width: 640, height: 360 }));
    const renderer = new StageTextureRenderer({
      app: {
        stage: { children: [] },
        renderer: { render, extract: { pixels: extractPixels } },
      } as any,
      width: 640,
      height: 360,
      getTrackById: () => undefined,
    });
    const texture = { width: 640, height: 360 } as any;

    const result = await renderer.renderTextureToBitmap(texture);

    expect(result).toBe(bitmap);
    const renderCall = render.mock.calls[0]?.[0];
    expect(renderCall.clear).toBe(true);
    expect(renderCall.target).toBeTruthy();
    expect(renderCall.container.texture).toBe(texture);
    expect(extractPixels).toHaveBeenCalledWith(expect.anything());
    expect(createImageBitmapMock.mock.calls[0]?.[0]).toBeInstanceOf(TestImageData);
  });

  it('reads WebGPU render textures without Pixi canvas extraction', async () => {
    stubImageData();
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 8, MAP_READ: 1 });
    vi.stubGlobal('GPUMapMode', { READ: 1 });

    const bitmap = { width: 2, height: 1 } as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const mappedBytes = new Uint8Array(256);
    mappedBytes.set([30, 20, 10, 255, 70, 60, 50, 255]);
    const buffer = {
      mapAsync: vi.fn().mockResolvedValue(undefined),
      getMappedRange: vi.fn(() => mappedBytes.buffer),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const encoder = {
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn(() => 'command-buffer'),
    };
    const gpuTexture = {};
    const device = {
      createBuffer: vi.fn(() => buffer),
      createCommandEncoder: vi.fn(() => encoder),
      queue: { submit: vi.fn() },
    };
    const extractPixels = vi.fn();
    const source = {
      pixelWidth: 2,
      pixelHeight: 1,
      format: 'bgra8unorm',
    };
    const captureTexture = {
      width: 2,
      height: 1,
      source,
    };
    const renderer = new StageTextureRenderer({
      app: {
        stage: { children: [] },
        renderer: {
          type: RendererType.WEBGPU,
          render: vi.fn(),
          extract: { pixels: extractPixels },
          gpu: { device },
          texture: { getGpuSource: vi.fn(() => gpuTexture) },
        },
      } as any,
      width: 2,
      height: 1,
      getTrackById: () => undefined,
    });
    (renderer as any).captureTexture = captureTexture;

    await renderer.renderTextureToBitmap({ width: 2, height: 1 } as any);

    expect(extractPixels).not.toHaveBeenCalled();
    expect(encoder.copyTextureToBuffer).toHaveBeenCalledWith(
      { texture: gpuTexture },
      { buffer, bytesPerRow: 256, rowsPerImage: 1 },
      { width: 2, height: 1, depthOrArrayLayers: 1 },
    );
    const imageData = createImageBitmapMock.mock.calls[0]?.[0] as ImageData;
    expect([...imageData.data]).toEqual([10, 20, 30, 255, 50, 60, 70, 255]);
  });
});
