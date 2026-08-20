/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageDataHasTransparentPixels, resizeImage } from '~/utils/file-thumbnail-generator';

interface FakeCanvasContext {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  fillStyle: string;
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  static contexts: FakeCanvasContext[] = [];
  static alphaValue = 255;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    const context: FakeCanvasContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn((x: number, y: number, width: number, height: number) => {
        void x;
        void y;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) {
          data[i] = FakeOffscreenCanvas.alphaValue;
        }
        return { data } as ImageData;
      }),
      fillStyle: '',
    };
    FakeOffscreenCanvas.contexts.push(context);
    return context;
  }

  async convertToBlob() {
    return new Blob(['thumbnail'], { type: 'image/webp' });
  }
}

describe('file-thumbnail-generator image thumbnails', () => {
  const closeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeOffscreenCanvas.contexts = [];
    FakeOffscreenCanvas.alphaValue = 255;
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 100,
        height: 50,
        close: closeMock,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects transparent pixels in image data', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 128]);
    expect(imageDataHasTransparentPixels({ data } as ImageData)).toBe(true);
  });

  it('draws a checkerboard behind transparent image thumbnails', async () => {
    FakeOffscreenCanvas.alphaValue = 128;

    const blob = await resizeImage(new File(['image'], 'image.png'), 50, 50);
    const context = FakeOffscreenCanvas.contexts[0]!;

    expect(blob.type).toBe('image/webp');
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 50, 25);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 50, 25);
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('keeps opaque image thumbnails without checkerboard compositing', async () => {
    await resizeImage(new File(['image'], 'image.jpg'), 50, 50);
    const context = FakeOffscreenCanvas.contexts[0]!;

    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 50, 25);
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
});
