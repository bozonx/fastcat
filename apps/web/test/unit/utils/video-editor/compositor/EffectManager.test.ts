import { describe, it, expect, vi } from 'vitest';

import { EffectManager } from '~/utils/video-editor/compositor/EffectManager';
import type { CompositorClip, CompositorTrack } from '~/utils/video-editor/compositor/types';

// Mock ClipMaskFilter to avoid real Pixi Filter creation without WebGL
vi.mock('~/utils/video-editor/compositor/filters/ClipMaskFilter', () => ({
  ClipMaskFilter: class MockClipMaskFilter {
    uMask: unknown = null;
    uMode: number = 0;
    uInvert: boolean = false;
    destroy = vi.fn();
    constructor(opts: { uMask: unknown; uMode: number; uInvert: boolean }) {
      this.uMask = opts.uMask;
      this.uMode = opts.uMode;
      this.uInvert = opts.uInvert;
    }
  },
}));

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    clipKind: 'video',
    sprite: { filters: null, alpha: 1, blendMode: 'normal' } as any,
    effectFilters: new Map(),
    effects: [],
    maskActive: false,
    mask: undefined,
    maskState: null,
    ...overrides,
  } as unknown as CompositorClip;
}

describe('EffectManager.applyClipEffects', () => {
  it('creates effectFilters map if missing', () => {
    const em = new EffectManager();
    const clip = makeClip({ effectFilters: undefined });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    expect(clip.effectFilters).toBeInstanceOf(Map);
  });

  it('returns early when sprite is null', () => {
    const em = new EffectManager();
    const clip = makeClip({ sprite: null });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    // Should not throw
  });

  it('sets filters to null when previewEffectsEnabled is false and no mask', () => {
    const em = new EffectManager();
    const clip = makeClip();
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    expect(clip.sprite!.filters).toBeNull();
  });

  it('sets filters to [maskFilter] when previewEffectsEnabled is false but mask is active', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'alpha', invert: false, source: { path: '/mask.png' } } as any,
      maskState: {
        clipKind: 'image',
        imageSource: { width: 10, height: 10, update: vi.fn() } as any,
      } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    expect(clip.sprite!.filters).toHaveLength(1);
    expect(clip.effectFilters!.has('__mask')).toBe(true);
  });

  it('sets filters to null when previewEffectsEnabled is true and no effects and no mask', () => {
    const em = new EffectManager();
    const clip = makeClip({ effects: [] });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    expect(clip.sprite!.filters).toBeNull();
  });
});

describe('EffectManager.syncMaskFilter', () => {
  it('removes existing mask filter when maskActive is false', () => {
    const em = new EffectManager();
    const destroySpy = vi.fn();
    const clip = makeClip({
      maskActive: false,
      mask: { mode: 'alpha', invert: false, source: { path: '/mask.png' } } as any,
      maskState: null,
      effectFilters: new Map([['__mask', { destroy: destroySpy } as any]]),
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    expect(destroySpy).toHaveBeenCalled();
    expect(clip.effectFilters!.has('__mask')).toBe(false);
  });

  it('returns null when maskState has no imageSource', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'alpha', invert: false, source: { path: '/mask.png' } } as any,
      maskState: { clipKind: 'image', imageSource: null } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    // No mask filter should be applied
    expect(clip.sprite!.filters).toBeNull();
  });

  it('returns null when video maskState has no lastVideoFrame', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'luma', invert: false, source: { path: '/mask.mp4' } } as any,
      maskState: {
        clipKind: 'video',
        imageSource: { width: 10, height: 10, update: vi.fn(), resize: vi.fn() } as any,
        lastVideoFrame: null,
      } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: true });
    expect(clip.sprite!.filters).toBeNull();
  });

  it('creates mask filter for image mask with alpha mode', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'alpha', invert: false, source: { path: '/mask.png' } } as any,
      maskState: {
        clipKind: 'image',
        imageSource: { width: 10, height: 10, update: vi.fn() } as any,
      } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    expect(clip.effectFilters!.has('__mask')).toBe(true);
    expect(clip.sprite!.filters).toHaveLength(1);
  });

  it('creates mask filter for image mask with luma mode', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'luma', invert: true, source: { path: '/mask.png' } } as any,
      maskState: {
        clipKind: 'image',
        imageSource: { width: 10, height: 10, update: vi.fn() } as any,
      } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    expect(clip.effectFilters!.has('__mask')).toBe(true);
    expect(clip.sprite!.filters).toHaveLength(1);
  });

  it('updates existing mask filter instead of creating new one', () => {
    const em = new EffectManager();
    const existingFilter = { uMask: null, uMode: 0, uInvert: false, destroy: vi.fn() };
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'luma', invert: false, source: { path: '/mask.png' } } as any,
      maskState: {
        clipKind: 'image',
        imageSource: { width: 10, height: 10, update: vi.fn() } as any,
      } as any,
      effectFilters: new Map([['__mask', existingFilter as any]]),
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    // Should reuse the existing filter, not create a new one
    expect(clip.effectFilters!.get('__mask')).toBe(existingFilter);
    expect(existingFilter.uMode).toBe(1.0);
    expect(existingFilter.uInvert).toBe(false);
  });

  it('creates mask filter for video mask with lastVideoFrame', () => {
    const em = new EffectManager();
    const clip = makeClip({
      maskActive: true,
      mask: { mode: 'alpha', invert: false, source: { path: '/mask.mp4' } } as any,
      maskState: {
        clipKind: 'video',
        imageSource: { width: 10, height: 10, update: vi.fn(), resize: vi.fn() } as any,
        lastVideoFrame: { closed: false, displayWidth: 10, displayHeight: 10 } as any,
      } as any,
    });
    em.applyClipEffects(clip, { previewEffectsEnabled: false });
    expect(clip.effectFilters!.has('__mask')).toBe(true);
  });
});

describe('EffectManager.applyTrackEffects', () => {
  it('creates effectFilters map if missing', () => {
    const em = new EffectManager();
    const track = {
      container: { filters: null },
      effectFilters: undefined,
      effects: [],
    } as unknown as CompositorTrack;
    em.applyTrackEffects(track, { previewEffectsEnabled: true });
    expect(track.effectFilters).toBeInstanceOf(Map);
  });

  it('returns early when container is null', () => {
    const em = new EffectManager();
    const track = { container: null, effectFilters: new Map() } as unknown as CompositorTrack;
    em.applyTrackEffects(track, { previewEffectsEnabled: true });
  });

  it('sets filters to null when previewEffectsEnabled is false', () => {
    const em = new EffectManager();
    const track = {
      container: { filters: ['fake'] },
      effectFilters: new Map(),
      effects: [],
    } as unknown as CompositorTrack;
    em.applyTrackEffects(track, { previewEffectsEnabled: false });
    expect(track.container.filters).toBeNull();
  });

  it('sets filters to null when previewEffectsEnabled is true and no effects', () => {
    const em = new EffectManager();
    const track = {
      container: { filters: ['fake'] },
      effectFilters: new Map(),
      effects: [],
    } as unknown as CompositorTrack;
    em.applyTrackEffects(track, { previewEffectsEnabled: true });
    expect(track.container.filters).toBeNull();
  });
});

describe('EffectManager.applyMasterEffects', () => {
  it('returns early when container is null', () => {
    const em = new EffectManager();
    em.applyMasterEffects(null as any, [], new Map(), { previewEffectsEnabled: true });
  });

  it('sets filters to null when previewEffectsEnabled is false', () => {
    const em = new EffectManager();
    const container = { filters: ['fake'] } as any;
    em.applyMasterEffects(container, [], new Map(), { previewEffectsEnabled: false });
    expect(container.filters).toBeNull();
  });

  it('destroys old filters from the filtersMap', () => {
    const em = new EffectManager();
    const destroySpy = vi.fn();
    const filtersMap = new Map([['old', { destroy: destroySpy } as any]]);
    const container = { filters: null } as any;
    em.applyMasterEffects(container, [], filtersMap, { previewEffectsEnabled: true });
    expect(destroySpy).toHaveBeenCalled();
    expect(filtersMap.size).toBe(0);
    expect(container.filters).toBeNull();
  });
});
