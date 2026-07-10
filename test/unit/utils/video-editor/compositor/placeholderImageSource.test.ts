/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

const imageSourceMock = vi.hoisted(() =>
  vi.fn(function MockImageSource(this: { resource?: unknown }, params: { resource: unknown }) {
    this.resource = params.resource;
  }),
);

vi.mock('pixi.js', () => ({
  ImageSource: imageSourceMock,
}));

describe('createPlaceholderImageSource', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    imageSourceMock.mockClear();
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
});
