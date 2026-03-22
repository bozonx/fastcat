// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransitionRenderer } from '~/utils/video-editor/compositor/TransitionRenderer';

vi.mock('pixi.js', async () => {
  class MockSprite {
    public static instances: MockSprite[] = [];
    public texture: any;
    public x = 0;
    public y = 0;
    public width = 0;
    public height = 0;
    public alpha = 1;
    public visible = true;
    public filters: any = null;
    public blendMode: any = 'normal';
    public anchor = { set: vi.fn() };
    public scale = { set: vi.fn() };

    constructor(texture: any) {
      this.texture = texture;
      MockSprite.instances.push(this);
    }

    destroy = vi.fn();
  }

  return {
    Sprite: MockSprite,
    Texture: {
      EMPTY: { id: 'empty-texture' },
    },
  };
});

describe('TransitionRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders shader background transition and hides lower stage layers after composing transition sprite', async () => {
    const renderer = new TransitionRenderer();
    const lowerChild = { __trackId: 'track-lower', visible: true } as any;
    const sameLayerChild = { __trackId: 'track-current', visible: true } as any;
    const transitionSprite = {
      visible: false,
      filters: ['stale'],
      scale: { set: vi.fn() },
      width: 0,
      height: 0,
      alpha: 0,
      blendMode: 'normal',
      texture: null,
    } as any;
    const clip = {
      itemId: 'clip-current',
      startUs: 1_000,
      layer: 2,
      clipKind: 'video',
      blendMode: 'screen',
      sprite: { visible: true },
      transitionSprite,
      transitionFilter: { id: 'existing-filter' },
      transitionFromTexture: null,
      transitionToTexture: null,
      transitionOutputTexture: null,
    } as any;
    const inactiveClip = {
      itemId: 'clip-inactive',
      sprite: { visible: true },
      transitionSprite: { visible: true, filters: ['old'] },
    } as any;

    const app = {
      renderer: {
        render: vi.fn(),
      },
      stage: {
        children: [lowerChild, sameLayerChild, transitionSprite],
      },
    } as any;
    const stageTextureRenderer = {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      ensureTransitionSprite: vi.fn(() => transitionSprite),
    } as any;
    const transitionManager = {
      ensureUsableTransitionFilter: vi.fn(() => ({ id: 'usable-filter' })),
      updateTransitionFilterSafely: vi.fn(() => ({ id: 'updated-filter' })),
    } as any;
    const textureFactory = vi.fn(
      (texture: any) => texture ?? { id: `rt-${textureFactory.mock.calls.length}` },
    );

    await renderer.applyShaderTransitions([clip], 1_500, {
      app,
      clips: [inactiveClip, clip],
      width: 1920,
      height: 1080,
      transitionManager,
      stageTextureRenderer,
      getTrackById: (trackId) => {
        if (trackId === 'track-lower') {
          return { id: 'track-lower', layer: 0 } as any;
        }
        if (trackId === 'track-current') {
          return { id: 'track-current', layer: 2 } as any;
        }
        return undefined;
      },
      getActiveTransitionState: () => ({
        manifest: { renderMode: 'shader' },
        progress: 0.5,
        curve: 'linear',
        edge: 'in',
        transition: { durationUs: 1_000, mode: 'background', params: { softness: 1 } },
      }),
      ensureTransitionRenderTexture: textureFactory as any,
      findPrevClipOnLayer: vi.fn(),
      findNextClipOnLayer: vi.fn(),
      createAbortController: vi.fn(() => new AbortController()),
      getVideoSampleForClip: vi.fn(),
      updateClipTextureFromSample: vi.fn(),
    });

    expect(inactiveClip.transitionSprite.visible).toBe(false);
    expect(inactiveClip.transitionSprite.filters).toBeNull();
    expect(stageTextureRenderer.renderSingleClipToTexture).toHaveBeenCalledWith(
      clip,
      clip.transitionToTexture,
      true,
    );
    expect(stageTextureRenderer.renderLowerLayersToTexture).toHaveBeenCalledWith(
      2,
      clip.transitionFromTexture,
    );
    expect(transitionManager.ensureUsableTransitionFilter).toHaveBeenCalledWith(clip, {
      renderMode: 'shader',
    });
    expect(transitionManager.updateTransitionFilterSafely).toHaveBeenCalledTimes(1);
    expect(app.renderer.render).toHaveBeenCalledTimes(1);
    expect(transitionSprite.texture).toBe(clip.transitionOutputTexture);
    expect(transitionSprite.visible).toBe(true);
    expect(transitionSprite.blendMode).toBe('screen');
    expect(lowerChild.visible).toBe(false);
    expect(sameLayerChild.visible).toBe(true);
  });

  it('renders previous clip into transition texture for adjacent mode and hides previous clip sprite', async () => {
    const renderer = new TransitionRenderer();
    const prevClip = {
      itemId: 'clip-prev',
      startUs: 0,
      endUs: 1_000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 500_000,
      sourceDurationUs: 1_500_000,
      clipKind: 'video',
      sink: { id: 'sink' },
      lastVideoFrame: null,
      sprite: { visible: true },
      speed: 1,
    } as any;
    const clip = {
      itemId: 'clip-current',
      startUs: 1_000,
      layer: 1,
      clipKind: 'video',
      sprite: { visible: true },
      transitionSprite: null,
      transitionFilter: { id: 'existing-filter' },
      transitionFromTexture: null,
      transitionToTexture: null,
      transitionOutputTexture: null,
    } as any;
    const transitionSprite = {
      visible: false,
      filters: null,
      scale: { set: vi.fn() },
      width: 0,
      height: 0,
      alpha: 0,
      blendMode: 'normal',
      texture: null,
    } as any;
    const sample = {
      frame: { id: 'frame' },
      close: vi.fn(),
    };
    const app = {
      renderer: {
        render: vi.fn(),
      },
      stage: {
        children: [],
      },
    } as any;
    const stageTextureRenderer = {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      ensureTransitionSprite: vi.fn(() => transitionSprite),
    } as any;
    const transitionManager = {
      ensureUsableTransitionFilter: vi.fn(() => ({ id: 'usable-filter' })),
      updateTransitionFilterSafely: vi.fn(() => ({ id: 'updated-filter' })),
    } as any;
    const getVideoSampleForClip = vi.fn(async () => sample);
    const updateClipTextureFromSample = vi.fn(async () => undefined);

    await renderer.applyShaderTransitions([clip], 1_250, {
      app,
      clips: [clip, prevClip],
      width: 1280,
      height: 720,
      transitionManager,
      stageTextureRenderer,
      getTrackById: vi.fn(),
      getActiveTransitionState: () => ({
        manifest: { renderMode: 'shader' },
        progress: 0.25,
        curve: 'linear',
        edge: 'in',
        transition: { durationUs: 1_000, mode: 'adjacent', params: {} },
      }),
      ensureTransitionRenderTexture: ((texture: any) => texture ?? { id: Math.random() }) as any,
      findPrevClipOnLayer: vi.fn(() => prevClip),
      findNextClipOnLayer: vi.fn(),
      createAbortController: vi.fn(() => new AbortController()),
      getVideoSampleForClip,
      updateClipTextureFromSample,
    });

    expect(getVideoSampleForClip).toHaveBeenCalledTimes(1);
    expect(updateClipTextureFromSample).toHaveBeenCalledWith(sample, prevClip);
    expect(stageTextureRenderer.renderSingleClipToTexture).toHaveBeenCalledWith(
      prevClip,
      clip.transitionFromTexture,
    );
    expect(prevClip.sprite.visible).toBe(false);
    expect(sample.close).toHaveBeenCalledTimes(1);
    expect(app.renderer.render).toHaveBeenCalledTimes(1);
  });
});
