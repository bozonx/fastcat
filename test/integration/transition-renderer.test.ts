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
    Texture: class MockTexture {
      static EMPTY = { id: 'empty-texture' };
      static from = vi.fn(() => ({ destroy: vi.fn() }));
      source: any;
      constructor(opts: any) {
        this.source = opts?.source;
      }
      destroy = vi.fn();
    },
    ImageSource: class MockImageSource {
      width = 0;
      height = 0;
      resource: any;
      constructor(opts: any) {
        this.resource = opts?.resource;
        this.width = opts?.resource?.width ?? 0;
        this.height = opts?.resource?.height ?? 0;
      }
      resize = vi.fn((w: number, h: number) => {
        this.width = w;
        this.height = h;
      });
      update = vi.fn();
    },
  };
});

const bitmap = { close: vi.fn(), width: 1920, height: 1080 } as unknown as ImageBitmap;
const computeRunner = {
  isReady: vi.fn(() => true),
  applyTransition: vi.fn(async () => bitmap),
} as any;
const textureToBitmap = vi.fn(async () => bitmap);
const manifest = {
  renderMode: 'shader',
  toTransitionSpec: vi.fn(() => ({ type: 'crossfade' })),
};

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
      startTicks: 1_000,
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
      computeRunner,
      textureToBitmap,
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
        manifest,
        progress: 0.5,
        curve: 'linear',
        edge: 'in',
        transition: {
          type: 'dissolve',
          durationTicks: 1_000,
          mode: 'background',
          params: { softness: 1 },
        },
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
    expect(computeRunner.applyTransition).toHaveBeenCalledTimes(1);
    expect(app.renderer.render).toHaveBeenCalledTimes(1);
    expect(transitionSprite.texture).toBe(clip.transitionOutputTexture);
    expect(transitionSprite.visible).toBe(true);
    expect(transitionSprite.blendMode).toBe('screen');
    expect(lowerChild.visible).toBe(false);
    expect(sameLayerChild.visible).toBe(true);
  });

  it('uses GPU texture transitions when available', async () => {
    const renderer = new TransitionRenderer();
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
    const clip = {
      itemId: 'clip-current',
      startTicks: 1_000,
      layer: 2,
      clipKind: 'video',
      blendMode: 'screen',
      sprite: { visible: true },
      transitionSprite,
      transitionFilter: null,
      transitionFromTexture: null,
      transitionToTexture: null,
      transitionOutputTexture: null,
    } as any;
    const lowerChild = { __trackId: 'track-lower', visible: true } as any;
    const sameLayerChild = { __trackId: 'track-current', visible: true } as any;
    const app = {
      renderer: { render: vi.fn() },
      stage: { children: [lowerChild, sameLayerChild, transitionSprite] },
    } as any;
    const stageTextureRenderer = {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      ensureTransitionSprite: vi.fn(() => transitionSprite),
      renderCombinedTransitionTexture: vi.fn(),
      renderTextureToBitmap: vi.fn(),
    };
    const applyTransition = vi.fn(async () => bitmap);
    const applyTransitionToTexture = vi.fn(() => true);
    const gpuComputeRunner = {
      isReady: vi.fn(() => true),
      applyTransition,
      applyTransitionToTexture,
    } as any;
    const textureFactory = vi.fn(
      (texture: any) => texture ?? { id: `rt-${textureFactory.mock.calls.length}` },
    );

    await renderer.applyShaderTransitions([clip], 1_500, {
      app,
      clips: [clip],
      width: 1920,
      height: 1080,
      computeRunner: gpuComputeRunner,
      textureToBitmap,
      transitionManager: {} as any,
      stageTextureRenderer: stageTextureRenderer as any,
      getTrackById: (trackId: string) =>
        ({ id: trackId, layer: trackId === 'track-lower' ? 1 : 2 }) as any,
      getActiveTransitionState: () => ({
        manifest,
        progress: 0.5,
        curve: 'linear',
        edge: 'in',
        transition: {
          type: 'dissolve',
          durationTicks: 1_000,
          mode: 'background',
          params: {},
        },
      }),
      ensureTransitionRenderTexture: textureFactory as any,
      findPrevClipOnLayer: vi.fn(),
      findNextClipOnLayer: vi.fn(),
      createAbortController: vi.fn(() => new AbortController()),
      getVideoSampleForClip: vi.fn(),
      updateClipTextureFromSample: vi.fn(),
    });

    expect(applyTransitionToTexture).toHaveBeenCalledWith({
      from: clip.transitionFromTexture,
      to: clip.transitionToTexture,
      output: clip.transitionOutputTexture,
      spec: { type: 'crossfade' },
      progress: 0.5,
      speed: 1,
    });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(textureToBitmap).not.toHaveBeenCalled();
    expect(app.renderer.render).not.toHaveBeenCalled();
    expect(transitionSprite.texture).toBe(clip.transitionOutputTexture);
    expect(transitionSprite.visible).toBe(true);
    expect(transitionSprite.alpha).toBe(1);
    expect(transitionSprite.blendMode).toBe('screen');
    expect(transitionSprite.filters).toBeNull();
    expect(clip.sprite.visible).toBe(false);
    expect(lowerChild.visible).toBe(false);
    expect(sameLayerChild.visible).toBe(true);
  });

  it('renders previous clip into transition texture for adjacent mode and hides previous clip sprite', async () => {
    const renderer = new TransitionRenderer();
    const prevClip = {
      itemId: 'clip-prev',
      startTicks: 0,
      endTicks: 1_000,
      sourceStartTicks: 0,
      sourceRangeDurationTicks: 500_000,
      sourceDurationTicks: 1_500_000,
      clipKind: 'video',
      sink: { id: 'sink' },
      lastVideoFrame: null,
      sprite: { visible: true },
      speed: 1,
    } as any;
    const clip = {
      itemId: 'clip-current',
      startTicks: 1_000,
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
      computeRunner,
      textureToBitmap,
      transitionManager,
      stageTextureRenderer,
      getTrackById: vi.fn(),
      getActiveTransitionState: () => ({
        manifest,
        progress: 0.25,
        curve: 'linear',
        edge: 'in',
        transition: { type: 'dissolve', durationTicks: 1_000, mode: 'adjacent', params: {} },
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

  it('forces an inactive static adjacent clip visible while rendering transition texture', async () => {
    const renderer = new TransitionRenderer();
    const prevClip = {
      itemId: 'clip-prev',
      clipKind: 'image',
      sprite: { visible: false },
    } as any;
    const clip = {
      itemId: 'clip-current',
      startTicks: 1_000,
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
    const stageTextureRenderer = {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      ensureTransitionSprite: vi.fn(() => transitionSprite),
    } as any;

    await renderer.applyShaderTransitions([clip], 1_250, {
      app: {
        renderer: { render: vi.fn() },
        stage: { children: [] },
      } as any,
      clips: [clip, prevClip],
      width: 1280,
      height: 720,
      computeRunner,
      textureToBitmap,
      transitionManager: {
        ensureUsableTransitionFilter: vi.fn(() => ({ id: 'usable-filter' })),
        updateTransitionFilterSafely: vi.fn(() => ({ id: 'updated-filter' })),
      } as any,
      stageTextureRenderer,
      getTrackById: vi.fn(),
      getActiveTransitionState: () => ({
        manifest,
        progress: 0.25,
        curve: 'linear',
        edge: 'in',
        transition: { type: 'dissolve', durationTicks: 1_000, mode: 'adjacent', params: {} },
      }),
      ensureTransitionRenderTexture: ((texture: any) => texture ?? { id: Math.random() }) as any,
      findPrevClipOnLayer: vi.fn(() => prevClip),
      findNextClipOnLayer: vi.fn(),
      createAbortController: vi.fn(() => new AbortController()),
      getVideoSampleForClip: vi.fn(),
      updateClipTextureFromSample: vi.fn(),
    });

    expect(stageTextureRenderer.renderSingleClipToTexture).toHaveBeenCalledWith(
      prevClip,
      clip.transitionFromTexture,
      true,
    );
    expect(prevClip.sprite.visible).toBe(false);
  });

  it('captures transition textures through StageTextureRenderer when no override is provided', async () => {
    const renderer = new TransitionRenderer();
    const fromBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const toBitmap = { close: vi.fn() } as unknown as ImageBitmap;
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
    const clip = {
      itemId: 'clip-current',
      startTicks: 1_000,
      layer: 1,
      clipKind: 'video',
      sprite: { visible: true },
      transitionSprite,
      transitionFromTexture: null,
      transitionToTexture: null,
      transitionOutputTexture: null,
    } as any;
    const renderTextureToBitmap = vi
      .fn()
      .mockResolvedValueOnce(fromBitmap)
      .mockResolvedValueOnce(toBitmap);
    const stageTextureRenderer = {
      renderSingleClipToTexture: vi.fn(),
      renderLowerLayersToTexture: vi.fn(),
      renderTextureToBitmap,
      ensureTransitionSprite: vi.fn(() => transitionSprite),
    } as any;

    await renderer.applyShaderTransitions([clip], 1_500, {
      app: {
        renderer: { render: vi.fn() },
        stage: { children: [] },
      } as any,
      clips: [clip],
      width: 1280,
      height: 720,
      computeRunner,
      transitionManager: {} as any,
      stageTextureRenderer,
      getTrackById: vi.fn(),
      getActiveTransitionState: () => ({
        manifest,
        progress: 0.5,
        curve: 'linear',
        edge: 'in',
        transition: { type: 'dissolve', durationTicks: 1_000, mode: 'background', params: {} },
      }),
      ensureTransitionRenderTexture: ((texture: any) => texture ?? { id: Math.random() }) as any,
      findPrevClipOnLayer: vi.fn(),
      findNextClipOnLayer: vi.fn(),
      createAbortController: vi.fn(() => new AbortController()),
      getVideoSampleForClip: vi.fn(),
      updateClipTextureFromSample: vi.fn(),
    });

    expect(renderTextureToBitmap).toHaveBeenCalledTimes(2);
    expect(computeRunner.applyTransition).toHaveBeenCalledWith(
      expect.objectContaining({ from: fromBitmap, to: toBitmap }),
    );
  });
});
