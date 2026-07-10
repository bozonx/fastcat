/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

const imageSourceMock = vi.hoisted(() =>
  vi.fn(function MockImageSource(this: { resource?: unknown }, params: { resource: unknown }) {
    this.resource = params.resource;
  }),
);
const canvasSourceMock = vi.hoisted(() =>
  vi.fn(function MockCanvasSource(
    this: { resource?: unknown; update: ReturnType<typeof vi.fn> },
    params: { resource: unknown },
  ) {
    this.resource = params.resource;
    this.update = vi.fn();
  }),
);
const textureMock = vi.hoisted(() =>
  vi.fn(function MockTexture(
    this: { source?: unknown; dynamic?: boolean },
    params: { source: unknown; dynamic?: boolean },
  ) {
    this.source = params.source;
    this.dynamic = params.dynamic;
  }),
);

vi.mock('pixi.js', () => ({
  CanvasSource: canvasSourceMock,
  ImageSource: imageSourceMock,
  Texture: textureMock,
}));

describe('createPlaceholderImageSource', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    imageSourceMock.mockClear();
    canvasSourceMock.mockClear();
    textureMock.mockClear();
  });

  it('creates a 2d context before using the canvas as a Pixi image source', async () => {
    const clearRect = vi.fn();
    const getContext = vi.fn(() => ({ clearRect }));
    const canvases: Array<{ width: number; height: number; getContext: typeof getContext }> = [];

    globalThis.OffscreenCanvas = vi.fn(function MockOffscreenCanvas(
      this: { width: number; height: number; getContext: typeof getContext },
      width: number,
      height: number,
    ) {
      const canvas = { width, height, getContext };
      canvases.push(canvas);
      return canvas as unknown as OffscreenCanvas;
    }) as unknown as typeof OffscreenCanvas;

    const { createPlaceholderImageSource } = await import(
      '~/utils/video-editor/compositor/placeholderImageSource'
    );

    createPlaceholderImageSource();

    expect(globalThis.OffscreenCanvas).toHaveBeenCalledWith(2, 2);
    expect(canvases[0]?.getContext).toHaveBeenCalledWith('2d');
    expect(clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(imageSourceMock).toHaveBeenCalledWith({ resource: canvases[0] });
  });

  it('creates a dynamic canvas texture with an initialized rendering context', async () => {
    const clearRect = vi.fn();
    const fillRect = vi.fn();
    const context = { clearRect, fillRect, fillStyle: '' };
    const getContext = vi.fn(() => context);
    const canvases: Array<{ width: number; height: number; getContext: typeof getContext }> = [];

    globalThis.OffscreenCanvas = vi.fn(function MockOffscreenCanvas(
      this: { width: number; height: number; getContext: typeof getContext },
      width: number,
      height: number,
    ) {
      const canvas = { width, height, getContext };
      canvases.push(canvas);
      return canvas as unknown as OffscreenCanvas;
    }) as unknown as typeof OffscreenCanvas;

    const { createSolidColorTexture } = await import(
      '~/utils/video-editor/compositor/placeholderImageSource'
    );

    createSolidColorTexture('#ffffff');

    expect(canvases[0]?.getContext).toHaveBeenCalledWith('2d');
    expect(clearRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(context.fillStyle).toBe('#ffffff');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2, 2);
    expect(canvasSourceMock).toHaveBeenCalledWith({ resource: canvases[0] });
    expect(textureMock).toHaveBeenCalledWith({
      source: expect.objectContaining({ resource: canvases[0] }),
      dynamic: true,
    });
  });
});
