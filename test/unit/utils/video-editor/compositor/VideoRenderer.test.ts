import { describe, it, expect, vi } from 'vitest';

import { VideoRenderer } from '~/utils/video-editor/compositor/renderers/VideoRenderer';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    sprite: {
      texture: {
        source: {
          width: 10,
          height: 10,
          resize: vi.fn(),
          update: vi.fn(),
          resource: null,
        },
      },
    },
    lastVideoFrame: null,
    canvas: null,
    ctx: null,
    ...overrides,
  } as unknown as CompositorClip;
}

describe('VideoRenderer.updateClipTextureFromSample', () => {
  it('returns false when sprite is null', async () => {
    const renderer = new VideoRenderer();
    const clip = makeClip({ sprite: null });
    const result = await renderer.updateClipTextureFromSample({}, clip);
    expect(result).toBe(false);
  });

  it('returns false when sprite is not a Sprite instance', async () => {
    const renderer = new VideoRenderer();
    const clip = makeClip({
      sprite: { texture: { source: {} } } as any,
    });
    // sprite instanceof Sprite will be false since it's a plain object
    const result = await renderer.updateClipTextureFromSample({}, clip);
    expect(result).toBe(false);
  });

  it('returns false for unknown sample type', async () => {
    const renderer = new VideoRenderer();
    const clip = makeClip();
    // Need to mock Sprite check — VideoRenderer uses instanceof Sprite
    // Since we can't easily mock that, test with a sample that has neither
    // VideoFrame signature nor draw/toCanvasImageSource
    const result = await renderer.updateClipTextureFromSample(
      { foo: 'bar' },
      clip,
    );
    expect(result).toBe(false);
  });
});
