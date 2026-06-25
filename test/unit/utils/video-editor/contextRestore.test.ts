/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { resetCompositorClipsAfterContextRestored } from '~/utils/video-editor/compositor/contextRestore';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

describe('resetCompositorClipsAfterContextRestored', () => {
  it('clears nonVideoEffectCacheKey to force effect reprocessing', () => {
    const clip = {
      nonVideoEffectCacheKey: 'some-cache-key',
      textDirty: false,
      shapeDirty: false,
      lastVideoFrame: { close: vi.fn() } as unknown as VideoFrame,
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(clip.nonVideoEffectCacheKey).toBeUndefined();
    expect(clip.textDirty).toBe(true);
    expect(clip.shapeDirty).toBe(true);
    expect(clip.lastVideoFrame).toBeNull();
  });

  it('disposes lastVideoFrame during reset', () => {
    const closeFn = vi.fn();
    const clip = {
      nonVideoEffectCacheKey: 'cache',
      textDirty: false,
      shapeDirty: false,
      lastVideoFrame: { close: closeFn } as unknown as VideoFrame,
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(closeFn).toHaveBeenCalled();
    expect(clip.lastVideoFrame).toBeNull();
  });
});
