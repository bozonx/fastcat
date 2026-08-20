import { describe, it, expect, vi } from 'vitest';

import { CompositorRenderContextBuilder } from '~/utils/video-editor/compositor/CompositorRenderContextBuilder';
import type { CompositorClip, CompositorTrack } from '~/utils/video-editor/compositor/types';

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    app: { stage: { children: [] } } as any,
    canvas: new OffscreenCanvas(100, 100) as any,
    state: {
      width: 1920,
      height: 1080,
      clips: [] as CompositorClip[],
      lastRenderedTimeTicks: 0,
      stageSortDirty: false,
      activeSortDirty: false,
      contextLost: false,
      previewEffectsEnabled: true,
      previewEffectQuality: 'ultra' as const,
      masterEffects: null,
    },
    activeTrackerUpdate: vi.fn().mockReturnValue({ activeClips: [], activeChanged: false }),
    hideInactiveClipSprites: vi.fn(),
    prepareAdjustmentClips: vi.fn().mockResolvedValue(undefined),
    getVideoSampleForClip: vi.fn().mockResolvedValue(null),
    getClipById: vi.fn().mockReturnValue(undefined),
    getPrevClipOnLayer: vi.fn().mockReturnValue(null),
    getNextClipOnLayer: vi.fn().mockReturnValue(null),
    setClipSpriteVisible: vi.fn().mockReturnValue(true),
    getPreviewEffectsEnabled: vi.fn().mockReturnValue(true),
    setPreviewEffectsEnabled: vi.fn(),
    setPreviewEffectQuality: vi.fn(),
    setStageSortDirty: vi.fn(),
    setActiveSortDirty: vi.fn(),
    setLastRenderedTimeTicks: vi.fn(),
    resourceManager: { abortInFlight: vi.fn() } as any,
    videoFrameCache: { applyLimitMb: vi.fn() } as any,
    effectManager: {
      applyTrackEffects: vi.fn(),
      applyClipEffects: vi.fn(),
      applyMasterEffects: vi.fn(),
    } as any,
    transitionManager: {
      syncTransitionFilter: vi.fn(),
      computeTransitionOpacity: vi.fn().mockReturnValue(1),
      getActiveTransitionState: vi.fn().mockReturnValue(null),
    } as any,
    clipResourceManager: {
      getComputeRunner: vi.fn().mockReturnValue(null),
      applyEffectsToNonVideoClip: vi.fn().mockResolvedValue(undefined),
      updateClipTextureFromSample: vi.fn().mockResolvedValue(undefined),
      ensureTransitionRenderTexture: vi.fn().mockReturnValue({} as any),
    } as any,
    transitionRenderer: {
      applyShaderTransitions: vi.fn().mockResolvedValue(undefined),
    } as any,
    stageTextureRenderer: {
      renderDisplayObjectToBitmapForcedVisible: vi.fn().mockResolvedValue(null),
    } as any,
    stageManager: { sortStage: vi.fn() } as any,
    frameSampleOrchestrator: { process: vi.fn().mockReturnValue({ sampleRequests: [] }) } as any,
    timelineActiveClipProcessor: {} as any,
    canvasFallbackRenderer: { drawHudClip: vi.fn() } as any,
    shapeRenderer: { draw: vi.fn() } as any,
    textRenderer: { draw: vi.fn() } as any,
    layoutApplier: { applyTextLayout: vi.fn() } as any,
    trackRuntimeManager: {
      all: [] as CompositorTrack[],
      getById: vi.fn().mockReturnValue(undefined),
    } as any,
    masterEffectFilters: new Map(),
    ...overrides,
  };
}

describe('CompositorRenderContextBuilder.build', () => {
  it('returns a context with all required fields', () => {
    const builder = new CompositorRenderContextBuilder();
    const ctx = builder.build(makeParams());
    expect(ctx.width).toBe(1920);
    expect(ctx.height).toBe(1080);
    expect(ctx.clips).toEqual([]);
    expect(ctx.previewEffectsEnabled).toBe(true);
    expect(ctx.previewEffectQuality).toBe('ultra');
  });

  it('delegates applyVideoFrameCacheLimit to videoFrameCache', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.applyVideoFrameCacheLimit(256);
    expect(params.videoFrameCache.applyLimitMb).toHaveBeenCalledWith(256);
  });

  it('delegates abortInFlightResources to resourceManager', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.abortInFlightResources();
    expect(params.resourceManager.abortInFlight).toHaveBeenCalled();
  });

  it('delegates updateActiveClips to activeTrackerUpdate', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.updateActiveClips(100, 50);
    expect(params.activeTrackerUpdate).toHaveBeenCalledWith(100, 50);
  });

  it('delegates hideInactiveClipSprites', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    const clips: CompositorClip[] = [];
    ctx.hideInactiveClipSprites(clips);
    expect(params.hideInactiveClipSprites).toHaveBeenCalledWith(clips);
  });

  it('delegates applyTrackState to effectManager', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    const track = { id: 't1', layer: 0, container: {} as any } as CompositorTrack;
    ctx.applyTrackState(track);
    expect(params.effectManager.applyTrackEffects).toHaveBeenCalledWith(track, {
      previewEffectsEnabled: true,
    });
  });

  it('delegates sortStage to stageManager', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.sortStage();
    expect(params.stageManager.sortStage).toHaveBeenCalled();
  });

  it('delegates setStageSortDirty', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.setStageSortDirty(true);
    expect(params.setStageSortDirty).toHaveBeenCalledWith(true);
  });

  it('delegates setActiveSortDirty', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.setActiveSortDirty(false);
    expect(params.setActiveSortDirty).toHaveBeenCalledWith(false);
  });

  it('delegates setLastRenderedTimeTicks', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.setLastRenderedTimeTicks(42);
    expect(params.setLastRenderedTimeTicks).toHaveBeenCalledWith(42);
  });

  it('delegates prepareAdjustmentClips', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    await ctx.prepareAdjustmentClips([]);
    expect(params.prepareAdjustmentClips).toHaveBeenCalled();
  });

  it('delegates applyShaderTransitions to transitionRenderer', () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams();
    const ctx = builder.build(params);
    ctx.applyShaderTransitions([], 100_000);
    expect(params.transitionRenderer.applyShaderTransitions).toHaveBeenCalled();
  });

  it('applyTrackEffects returns noop when previewEffectsEnabled is false', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams({ getPreviewEffectsEnabled: vi.fn().mockReturnValue(false) });
    const ctx = builder.build(params);
    const cleanup = await ctx.applyTrackEffects();
    expect(cleanup).toBeInstanceOf(Function);
  });

  it('applyTrackEffects returns noop when computeRunner is not ready', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams({
      clipResourceManager: {
        getComputeRunner: vi.fn().mockReturnValue({ isReady: () => false }),
        applyEffectsToNonVideoClip: vi.fn(),
        updateClipTextureFromSample: vi.fn(),
        ensureTransitionRenderTexture: vi.fn(),
      } as any,
    });
    const ctx = builder.build(params);
    const cleanup = await ctx.applyTrackEffects();
    expect(cleanup).toBeInstanceOf(Function);
  });

  it('applyTrackEffects returns noop when no tracks have effects', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams({
      trackRuntimeManager: {
        all: [
          {
            id: 't1',
            layer: 0,
            container: { children: [], alpha: 1, blendMode: 'normal' } as any,
            effects: [],
          },
        ] as CompositorTrack[],
        getById: vi.fn(),
      } as any,
      clipResourceManager: {
        getComputeRunner: vi.fn().mockReturnValue({ isReady: () => true, applyEffects: vi.fn() }),
        applyEffectsToNonVideoClip: vi.fn(),
        updateClipTextureFromSample: vi.fn(),
        ensureTransitionRenderTexture: vi.fn(),
      } as any,
    });
    const ctx = builder.build(params);
    const cleanup = await ctx.applyTrackEffects();
    expect(cleanup).toBeInstanceOf(Function);
  });

  it('applyMasterEffects returns early when previewEffectsEnabled is false', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams({ getPreviewEffectsEnabled: vi.fn().mockReturnValue(false) });
    const ctx = builder.build(params);
    await ctx.applyMasterEffects();
    // Should call applyMasterEffects on effectManager with previewEffectsEnabled: false
    expect(params.effectManager.applyMasterEffects).toHaveBeenCalled();
  });

  it('applyMasterEffects returns early when no master specs', async () => {
    const builder = new CompositorRenderContextBuilder();
    const params = makeParams({
      state: {
        width: 1920,
        height: 1080,
        clips: [],
        lastRenderedTimeTicks: 0,
        stageSortDirty: false,
        activeSortDirty: false,
        contextLost: false,
        previewEffectsEnabled: true,
        previewEffectQuality: 'ultra' as const,
        masterEffects: null,
      },
      clipResourceManager: {
        getComputeRunner: vi.fn().mockReturnValue({ isReady: () => true, applyEffects: vi.fn() }),
        applyEffectsToNonVideoClip: vi.fn(),
        updateClipTextureFromSample: vi.fn(),
        ensureTransitionRenderTexture: vi.fn(),
      } as any,
    });
    const ctx = builder.build(params);
    await ctx.applyMasterEffects();
    // Should not throw
  });

  describe('hideStageBelowAdjustmentClips', () => {
    function makeAdjustmentSetup(spriteAlpha: number, containerAlpha = 1) {
      const adjustmentTexture = { id: 'rt' } as any;
      const lowerChild = { visible: true, __trackId: 'lower' } as any;
      const adjustmentChild = { visible: true, __trackId: 'adj' } as any;
      const upperChild = { visible: true, __trackId: 'upper' } as any;
      const tracks: Record<string, { layer: number; container: { alpha: number } }> = {
        lower: { layer: 0, container: { alpha: 1 } },
        adj: { layer: 1, container: { alpha: containerAlpha } },
        upper: { layer: 2, container: { alpha: 1 } },
      };
      const clip = {
        itemId: 'a1',
        clipKind: 'adjustment',
        trackId: 'adj',
        layer: 1,
        adjustmentSourceTexture: adjustmentTexture,
        sprite: { visible: true, alpha: spriteAlpha, texture: adjustmentTexture },
      } as unknown as CompositorClip;
      const params = makeParams({
        app: { stage: { children: [lowerChild, adjustmentChild, upperChild] } } as any,
        trackRuntimeManager: {
          all: [] as CompositorTrack[],
          getById: vi.fn((id: string) => tracks[id]),
        } as any,
      });
      return { params, clip, lowerChild, adjustmentChild, upperChild };
    }

    it('hides stage children below a fully-opaque adjustment clip', () => {
      // The adjustment sprite is a processed copy of everything below it; with a
      // transparent project background the raw semi-transparent content would
      // otherwise show through the overlay, visually weakening the effect.
      const builder = new CompositorRenderContextBuilder();
      const { params, clip, lowerChild, adjustmentChild, upperChild } = makeAdjustmentSetup(1);
      const ctx = builder.build(params);

      ctx.hideStageBelowAdjustmentClips([clip]);

      expect(lowerChild.visible).toBe(false);
      expect(adjustmentChild.visible).toBe(true);
      expect(upperChild.visible).toBe(true);
    });

    it('keeps lower layers visible while the adjustment is fading (alpha < 1)', () => {
      // A fading adjustment must blend with the originals so the effect
      // crossfades in/out instead of the whole content fading to background.
      const builder = new CompositorRenderContextBuilder();
      const { params, clip, lowerChild } = makeAdjustmentSetup(0.5);
      const ctx = builder.build(params);

      ctx.hideStageBelowAdjustmentClips([clip]);

      expect(lowerChild.visible).toBe(true);
    });

    it('accounts for the adjustment track container alpha', () => {
      const builder = new CompositorRenderContextBuilder();
      const { params, clip, lowerChild } = makeAdjustmentSetup(1, 0.5);
      const ctx = builder.build(params);

      ctx.hideStageBelowAdjustmentClips([clip]);

      expect(lowerChild.visible).toBe(true);
    });

    it('ignores adjustment clips whose sprite does not hold the processed texture', () => {
      const builder = new CompositorRenderContextBuilder();
      const { params, clip, lowerChild } = makeAdjustmentSetup(1);
      (clip.sprite as unknown as { texture: unknown }).texture = { id: 'other' };
      const ctx = builder.build(params);

      ctx.hideStageBelowAdjustmentClips([clip]);

      expect(lowerChild.visible).toBe(true);
    });
  });
});
