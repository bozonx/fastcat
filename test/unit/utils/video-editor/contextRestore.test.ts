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

  it('destroys effectFilters and clears sprite.filters', () => {
    const filterDestroy = vi.fn();
    const filterMap = new Map([['f1', { destroy: filterDestroy } as unknown as any]]);
    const spriteFilters = vi.fn();
    const clip = {
      textDirty: false,
      shapeDirty: false,
      effectFilters: filterMap,
      sprite: { filters: spriteFilters as unknown as any },
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(filterDestroy).toHaveBeenCalledTimes(1);
    expect(clip.effectFilters).toBeUndefined();
    expect(clip.sprite!.filters).toBeNull();
  });

  it('destroys transitionFilter, transitionSprite, and GPU render textures', () => {
    const filterDestroy = vi.fn();
    const spriteDestroy = vi.fn();
    const fromClose = vi.fn();
    const toClose = vi.fn();
    const outputClose = vi.fn();
    const combinedClose = vi.fn();
    const effectClose = vi.fn();

    const clip = {
      textDirty: false,
      shapeDirty: false,
      transitionFilter: { destroy: filterDestroy } as any,
      transitionFilterType: 'fade',
      transitionSprite: { destroy: spriteDestroy } as any,
      transitionFromTexture: { close: fromClose } as any,
      transitionToTexture: { close: toClose } as any,
      transitionOutputTexture: { close: outputClose } as any,
      transitionCombinedTexture: { close: combinedClose } as any,
      effectRenderTexture: { close: effectClose } as any,
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(filterDestroy).toHaveBeenCalledTimes(1);
    expect(clip.transitionFilter).toBeNull();
    expect(clip.transitionFilterType).toBeNull();
    expect(spriteDestroy).toHaveBeenCalledTimes(1);
    expect(clip.transitionSprite).toBeNull();
    expect(fromClose).toHaveBeenCalledTimes(1);
    expect(toClose).toHaveBeenCalledTimes(1);
    expect(outputClose).toHaveBeenCalledTimes(1);
    expect(combinedClose).toHaveBeenCalledTimes(1);
    expect(effectClose).toHaveBeenCalledTimes(1);
    expect(clip.transitionFromTexture).toBeNull();
    expect(clip.transitionToTexture).toBeNull();
    expect(clip.transitionOutputTexture).toBeNull();
    expect(clip.transitionCombinedTexture).toBeNull();
    expect(clip.effectRenderTexture).toBeNull();
  });

  it('resets HUD media states (background, content, frame)', () => {
    const bgFrameClose = vi.fn();
    const bgBitmapClose = vi.fn();
    const ctFrameClose = vi.fn();
    const frBitmapClose = vi.fn();

    const clip = {
      textDirty: false,
      shapeDirty: false,
      hudDirty: false,
      hudMediaStates: {
        background: {
          lastVideoFrame: { close: bgFrameClose } as any,
          bitmap: { close: bgBitmapClose } as any,
        },
        content: {
          lastVideoFrame: { close: ctFrameClose } as any,
          bitmap: null,
        },
        frame: {
          lastVideoFrame: null,
          bitmap: { close: frBitmapClose } as any,
        },
      },
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(bgFrameClose).toHaveBeenCalledTimes(1);
    expect(bgBitmapClose).toHaveBeenCalledTimes(1);
    expect(ctFrameClose).toHaveBeenCalledTimes(1);
    expect(frBitmapClose).toHaveBeenCalledTimes(1);
    expect(clip.hudDirty).toBe(true);
    expect(clip.hudMediaStates!.background!.lastVideoFrame).toBeNull();
    expect(clip.hudMediaStates!.background!.bitmap).toBeNull();
    expect(clip.hudMediaStates!.content!.lastVideoFrame).toBeNull();
    expect(clip.hudMediaStates!.frame!.bitmap).toBeNull();
  });

  it('destroys adjustmentSourceTexture during reset', () => {
    const destroyFn = vi.fn();
    const clip = {
      textDirty: false,
      shapeDirty: false,
      adjustmentSourceTexture: { destroy: destroyFn } as any,
    } as unknown as CompositorClip;

    resetCompositorClipsAfterContextRestored([clip]);

    expect(destroyFn).toHaveBeenCalledTimes(1);
    expect(clip.adjustmentSourceTexture).toBeNull();
  });

  it('is safe to call on clips with no GPU resources', () => {
    const clip = {
      textDirty: false,
      shapeDirty: false,
    } as unknown as CompositorClip;

    expect(() => resetCompositorClipsAfterContextRestored([clip])).not.toThrow();
    expect(clip.textDirty).toBe(true);
    expect(clip.shapeDirty).toBe(true);
  });
});
