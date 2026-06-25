import { describe, it, expect, vi } from 'vitest';

import { TransitionRenderer } from '~/utils/video-editor/compositor/TransitionRenderer';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    clipKind: 'video',
    layer: 0,
    startUs: 0,
    endUs: 1_000_000,
    durationUs: 1_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 1_000_000,
    sourceDurationUs: 1_000_000,
    speed: 1,
    sprite: { visible: true, alpha: 1, blendMode: 'normal' } as any,
    transitionSprite: null,
    transitionFromTexture: null,
    transitionToTexture: null,
    transitionOutputTexture: null,
    blendMode: 'normal',
    ...overrides,
  } as unknown as CompositorClip;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    app: { stage: { children: [] } } as any,
    clips: [] as CompositorClip[],
    width: 1920,
    height: 1080,
    computeRunner: { isReady: () => false, applyTransition: vi.fn() } as any,
    transitionManager: {} as any,
    stageTextureRenderer: {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      renderTextureToBitmap: vi.fn().mockResolvedValue(null),
      ensureTransitionSprite: vi.fn().mockReturnValue({ texture: null, scale: { set: vi.fn() }, width: 0, height: 0, alpha: 1, blendMode: 'normal', filters: null, visible: false } as any),
    } as any,
    getTrackById: vi.fn().mockReturnValue(undefined),
    getActiveTransitionState: vi.fn().mockReturnValue(null),
    ensureTransitionRenderTexture: vi.fn().mockReturnValue({} as any),
    findPrevClipOnLayer: vi.fn().mockReturnValue(null),
    findNextClipOnLayer: vi.fn().mockReturnValue(null),
    createAbortController: vi.fn().mockReturnValue(new AbortController()),
    removeAbortController: vi.fn(),
    getVideoSampleForClip: vi.fn().mockResolvedValue(null),
    updateClipTextureFromSample: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TransitionRenderer.destroy', () => {
  it('cleans up blit resources without errors', () => {
    const renderer = new TransitionRenderer();
    expect(() => renderer.destroy()).not.toThrow();
  });

  it('destroys existing blit sprite and texture', () => {
    const renderer = new TransitionRenderer();
    // Inject mock blit objects
    (renderer as unknown as { blitSprite: { destroy: ReturnType<typeof vi.fn> } }).blitSprite = {
      destroy: vi.fn(),
    };
    (renderer as unknown as { blitTexture: { destroy: ReturnType<typeof vi.fn> } }).blitTexture = {
      destroy: vi.fn(),
    };
    renderer.destroy();
    expect((renderer as unknown as { blitSprite: null }).blitSprite).toBeNull();
    expect((renderer as unknown as { blitTexture: null }).blitTexture).toBeNull();
  });
});

describe('TransitionRenderer.applyShaderTransitions', () => {
  it('hides all transition sprites at start', async () => {
    const renderer = new TransitionRenderer();
    const clipWithTransitionSprite = makeClip({
      transitionSprite: { visible: true, filters: ['fake'] } as any,
    });
    const params = makeParams({ clips: [clipWithTransitionSprite] });
    await renderer.applyShaderTransitions([], 0, params);
    expect(clipWithTransitionSprite.transitionSprite!.visible).toBe(false);
    expect(clipWithTransitionSprite.transitionSprite!.filters).toBeNull();
  });

  it('skips clips with no active transition state', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip();
    const params = makeParams({
      clips: [clip],
      getActiveTransitionState: vi.fn().mockReturnValue(null),
    });
    await renderer.applyShaderTransitions([clip], 500_000, params);
    // Should not throw, just skips
  });

  it('skips clips when computeRunner is not ready', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip();
    const params = makeParams({
      clips: [clip],
      getActiveTransitionState: vi.fn().mockReturnValue({
        opacity: 1,
        progress: 0.5,
        manifest: { renderMode: 'shader', toTransitionSpec: vi.fn() },
        transition: { type: 'fade', mode: 'adjacent', durationUs: 500_000 },
      }),
      computeRunner: { isReady: () => false, applyTransition: vi.fn() } as any,
    });
    await renderer.applyShaderTransitions([clip], 500_000, params);
    // Should not attempt transition
    expect(params.computeRunner.applyTransition).not.toHaveBeenCalled();
  });

  it('skips clips when manifest renderMode is not shader', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip();
    const params = makeParams({
      clips: [clip],
      getActiveTransitionState: vi.fn().mockReturnValue({
        opacity: 1,
        progress: 0.5,
        manifest: { renderMode: 'canvas' },
        transition: { type: 'fade', mode: 'adjacent', durationUs: 500_000 },
      }),
    });
    await renderer.applyShaderTransitions([clip], 500_000, params);
  });

  it('skips clips when manifest has no toTransitionSpec', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip();
    const params = makeParams({
      clips: [clip],
      getActiveTransitionState: vi.fn().mockReturnValue({
        opacity: 1,
        progress: 0.5,
        manifest: { renderMode: 'shader' },
        transition: { type: 'fade', mode: 'adjacent', durationUs: 500_000 },
      }),
    });
    await renderer.applyShaderTransitions([clip], 500_000, params);
  });

  it('skips clips with unsupported mode', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip();
    const params = makeParams({
      clips: [clip],
      getActiveTransitionState: vi.fn().mockReturnValue({
        opacity: 1,
        progress: 0.5,
        manifest: { renderMode: 'shader', toTransitionSpec: vi.fn() },
        transition: { type: 'fade', mode: 'unsupported', durationUs: 500_000 },
      }),
    });
    await renderer.applyShaderTransitions([clip], 500_000, params);
  });
});

describe('TransitionRenderer.renderTransitionClipToTexture', () => {
  it('renders image clip directly to texture', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip({ clipKind: 'image' });
    const params = makeParams({
      stageTextureRenderer: {
        renderSingleClipToTexture: vi.fn(),
        renderLowerLayersToTexture: vi.fn(),
        renderTextureToBitmap: vi.fn(),
        ensureTransitionSprite: vi.fn(),
      } as any,
    });
    const result = await (renderer as unknown as {
      renderTransitionClipToTexture: (clip: CompositorClip, texture: unknown, params: Record<string, unknown>) => Promise<boolean>;
    }).renderTransitionClipToTexture(clip, {}, params);
    expect(result).toBe(true);
    expect(params.stageTextureRenderer.renderSingleClipToTexture).toHaveBeenCalledWith(clip, {}, true);
  });

  it('renders solid clip directly to texture', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip({ clipKind: 'solid' });
    const params = makeParams({
      stageTextureRenderer: {
        renderSingleClipToTexture: vi.fn(),
      } as any,
    });
    const result = await (renderer as unknown as {
      renderTransitionClipToTexture: (clip: CompositorClip, texture: unknown, params: Record<string, unknown>) => Promise<boolean>;
    }).renderTransitionClipToTexture(clip, {}, params);
    expect(result).toBe(true);
  });

  it('returns false for adjustment clips', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip({ clipKind: 'adjustment' });
    const params = makeParams();
    const result = await (renderer as unknown as {
      renderTransitionClipToTexture: (clip: CompositorClip, texture: unknown, params: Record<string, unknown>) => Promise<boolean>;
    }).renderTransitionClipToTexture(clip, {}, params);
    expect(result).toBe(false);
  });

  it('returns false for video clip with no sink', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip({ clipKind: 'video', sink: undefined });
    const params = makeParams();
    const result = await (renderer as unknown as {
      renderTransitionClipToTexture: (clip: CompositorClip, texture: unknown, params: Record<string, unknown>) => Promise<boolean>;
    }).renderTransitionClipToTexture(clip, {}, params);
    expect(result).toBe(false);
  });

  it('returns false when sample is null and no cached frame', async () => {
    const renderer = new TransitionRenderer();
    const clip = makeClip({ clipKind: 'video', lastVideoFrame: null });
    const params = makeParams({
      getVideoSampleForClip: vi.fn().mockResolvedValue(null),
      stageTextureRenderer: {
        renderSingleClipToTexture: vi.fn(),
      } as any,
    });
    const result = await (renderer as unknown as {
      renderTransitionClipToTexture: (clip: CompositorClip, texture: unknown, params: Record<string, unknown>) => Promise<boolean>;
    }).renderTransitionClipToTexture(clip, {}, params);
    expect(result).toBe(false);
  });
});
