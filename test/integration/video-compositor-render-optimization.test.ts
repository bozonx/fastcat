// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { VideoCompositor } from '~/utils/video-editor/VideoCompositor';

describe('VideoCompositor render optimization', () => {
  function createCompositor() {
    const compositor = new VideoCompositor() as any;
    const app = {
      render: vi.fn(),
      renderer: {
        render: vi.fn(),
      },
      stage: {
        children: [] as any[],
      },
      ticker: {
        stop: vi.fn(),
      },
    };

    compositor.app = app;
    compositor.canvas = { id: 'canvas' } as any;
    compositor.clips = [];
    compositor.clipById = new Map();
    compositor.lastRenderedTimeUs = 1_000;
    compositor.stageSortDirty = false;
    compositor.activeSortDirty = false;

    return { compositor, app };
  }

  it('skips rendering when time is unchanged and no dirty flags', async () => {
    const { compositor, app } = createCompositor();

    const result = await compositor.renderFrame(1_000);

    expect(result).toEqual({ id: 'canvas' });
    expect(app.renderer.render).not.toHaveBeenCalled();
  });

  it('renders when stage sort is dirty even if time is unchanged', async () => {
    const { compositor, app } = createCompositor();
    compositor.stageSortDirty = true;

    await compositor.renderFrame(1_000);

    expect(app.renderer.render).toHaveBeenCalledTimes(1);
  });

  it('renders when preview effects state changes even if time is unchanged', async () => {
    const { compositor, app } = createCompositor();
    compositor.previewEffectsEnabled = true;

    await compositor.renderFrame(1_000, { previewEffectsEnabled: false });

    expect(compositor.previewEffectsEnabled).toBe(false);
    expect(app.renderer.render).toHaveBeenCalledTimes(1);
  });

  it('prepares adjustment clips before and after shader transitions during renderFrame', async () => {
    const { compositor, app } = createCompositor();
    compositor.lastRenderedTimeUs = 0;
    compositor.clips = [];
    compositor.tracks = [];
    compositor.trackById = new Map();
    compositor.activeTracker = {
      update: vi.fn(() => ({ activeClips: [], activeChanged: false })),
    };

    const events: string[] = [];
    compositor.prepareAdjustmentClips = vi.fn(() => {
      events.push('prepare');
    });
    compositor.transitionRenderer = {
      applyShaderTransitions: vi.fn(async () => {
        events.push('transition');
      }),
    };
    compositor.applyMasterEffects = vi.fn();

    await compositor.renderFrame(1_000);

    expect(compositor.prepareAdjustmentClips).toHaveBeenCalledTimes(1);
    expect(compositor.transitionRenderer.applyShaderTransitions).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['prepare', 'transition']);
    expect(app.renderer.render).toHaveBeenCalledTimes(1);
  });

  it('restores stage visibility after shader transitions render the current frame', async () => {
    const { compositor } = createCompositor();
    const lowerTrack = { visible: true, alpha: 1, blendMode: 'normal' } as any;
    const currentTrack = { visible: true, alpha: 1, blendMode: 'normal' } as any;
    compositor.app.stage.children = [lowerTrack, currentTrack];
    compositor.lastRenderedTimeUs = 0;
    compositor.clips = [];
    compositor.tracks = [];
    compositor.activeTracker = {
      update: vi.fn(() => ({ activeClips: [], activeChanged: false })),
    };
    compositor.transitionRenderer = {
      applyShaderTransitions: vi.fn(async () => {
        lowerTrack.visible = false;
      }),
    };
    compositor.applyMasterEffects = vi.fn();

    await compositor.renderFrame(1_000);

    expect(lowerTrack.visible).toBe(true);
    expect(currentTrack.visible).toBe(true);
  });

  it('sorts track containers and clip order inside a track when stage sort is dirty', async () => {
    const { compositor, app } = createCompositor();

    const topTrack = {
      __trackId: 'track-top',
      children: [{ __clipId: 'clip-late' }, { __clipId: 'clip-early' }],
      alpha: 1,
      blendMode: 'normal',
      filters: null,
    } as any;
    const bottomTrack = {
      __trackId: 'track-bottom',
      children: [],
      alpha: 1,
      blendMode: 'normal',
      filters: null,
    } as any;

    app.stage.children = [topTrack, bottomTrack];
    compositor.trackById = new Map([
      ['track-top', { id: 'track-top', layer: 2, container: topTrack }],
      ['track-bottom', { id: 'track-bottom', layer: 0, container: bottomTrack }],
    ]);
    compositor.tracks = [
      { id: 'track-top', layer: 2, container: topTrack },
      { id: 'track-bottom', layer: 0, container: bottomTrack },
    ];
    compositor.clipById = new Map([
      ['clip-late', { itemId: 'clip-late', startUs: 2_000, endUs: 3_000, layer: 2 }],
      ['clip-early', { itemId: 'clip-early', startUs: 0, endUs: 1_000, layer: 2 }],
    ]);
    compositor.stageSortDirty = true;

    await compositor.renderFrame(1_000);

    expect(app.stage.children.map((child: any) => child.__trackId)).toEqual([
      'track-bottom',
      'track-top',
    ]);
    expect(topTrack.children.map((child: any) => child.__clipId)).toEqual([
      'clip-early',
      'clip-late',
    ]);
  });

  it('merges explicit track payload with inferred clip layers', () => {
    const compositor = new VideoCompositor() as any;

    const tracks = compositor.buildTrackRuntimeList([
      { kind: 'track', id: 'top-track', layer: 0, opacity: 0.8, blendMode: 'screen' },
      { kind: 'clip', id: 'nested-clip', layer: 2 },
    ]);

    expect(tracks).toEqual([
      expect.objectContaining({ id: 'top-track', layer: 0, opacity: 0.8, blendMode: 'screen' }),
      expect.objectContaining({ id: 'track_2', layer: 2, opacity: 1, blendMode: 'normal' }),
    ]);
  });

  it('prewarms only nearby upcoming video clips through the shared frame cache path', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.clips = [
      {
        itemId: 'active',
        clipKind: 'video',
        sink: {},
        startUs: 0,
        sourceStartUs: 0,
        sourceRangeDurationUs: 5_000_000,
      },
      {
        itemId: 'near',
        clipKind: 'video',
        sink: {},
        startUs: 2_000_000,
        sourceStartUs: 500_000,
        sourceRangeDurationUs: 5_000_000,
      },
      {
        itemId: 'far',
        clipKind: 'video',
        sink: {},
        startUs: 5_000_000,
        sourceStartUs: 0,
        sourceRangeDurationUs: 5_000_000,
      },
    ];
    compositor.getVideoSampleForClip = vi.fn().mockResolvedValue({});

    await compositor.prewarmVideoFrames(0, 2_500_000);

    expect(compositor.getVideoSampleForClip).toHaveBeenCalledTimes(1);
    expect(compositor.getVideoSampleForClip).toHaveBeenCalledWith(
      expect.objectContaining({
        clip: expect.objectContaining({ itemId: 'near' }),
        sampleTimeS: 0.5,
      }),
    );
  });

  it('does not mark text clip dirty when style values are unchanged', async () => {
    const compositor = new VideoCompositor() as any;
    const clipStyle = {
      width: 320,
      fontSize: 64,
      fontWeight: '700',
      color: '#fff',
      align: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      backgroundColor: '#000000',
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
    };
    const clip = {
      itemId: 'text-1',
      startUs: 0,
      endUs: 1_000,
      durationUs: 1_000,
      sourceStartUs: 0,
      sourceDurationUs: 1_000,
      layer: 0,
      trackId: 'track_0',
      clipKind: 'text',
      text: 'Hello',
      style: clipStyle,
      textDirty: false,
      transitionSprite: null,
      transitionFilter: null,
      transitionFilterType: null,
      sprite: {
        parent: null,
        anchor: { set: vi.fn() },
        scale: { x: 1, y: 1 },
        width: 1,
        height: 1,
        rotation: 0,
        x: 0,
        y: 0,
      },
      imageSource: { width: 1920, height: 1080 },
      effectFilters: new Map(),
    } as any;

    compositor.clips = [clip];
    compositor.trackById = new Map();
    compositor.tracks = [];
    compositor.transitionFilters = new Map();
    await compositor.updateTimelineLayout([
      {
        kind: 'clip',
        id: 'text-1',
        trackId: 'track_0',
        layer: 0,
        timelineRange: { startUs: 0, durationUs: 1_000 },
        sourceRange: { startUs: 0, durationUs: 1_000 },
        text: 'Hello',
        style: { ...clipStyle },
      },
    ]);

    expect(clip.textDirty).toBe(false);
  });

  it('reapplies sprite layout immediately when transform changes in updateTimelineLayout', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.width = 1920;
    compositor.height = 1080;
    compositor.syncTrackRuntimes = vi.fn();
    compositor.getTrackRuntimeForClip = () => null;

    const sprite = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      scale: { x: 1, y: 1 },
      anchor: { set: vi.fn() },
      parent: null,
      tint: 0,
    } as any;

    compositor.clips = [
      {
        itemId: 'text-1',
        startUs: 0,
        endUs: 1_000,
        durationUs: 1_000,
        sourceStartUs: 0,
        sourceDurationUs: 1_000,
        layer: 0,
        trackId: 'track_0',
        clipKind: 'text',
        sourceKind: 'canvas',
        imageSource: { width: 1920, height: 1080 },
        sprite,
        transform: { position: { x: 0, y: 0 }, anchor: { preset: 'center' } },
        text: 'Hello',
        style: undefined,
        textDirty: false,
        effectFilters: new Map(),
        ctx: { measureText: () => ({ width: 100 }) },
      },
    ];

    await compositor.updateTimelineLayout([
      {
        kind: 'clip',
        id: 'text-1',
        trackId: 'track_0',
        layer: 0,
        timelineRange: { startUs: 0, durationUs: 1_000 },
        sourceRange: { startUs: 0, durationUs: 1_000 },
        text: 'Hello',
        transform: { position: { x: 120, y: -40 }, anchor: { preset: 'center' } },
      },
    ]);

    expect(sprite.x).toBe(1080);
    expect(sprite.y).toBe(500);
  });

  it('prepares adjustment textures for all active adjustment clips', () => {
    const compositor = new VideoCompositor() as any;
    compositor.width = 1920;
    compositor.height = 1080;
    compositor.app = {
      renderer: {
        render: vi.fn(),
      },
    };

    const textureA = { id: 'tex-a', width: 1920, height: 1080, uid: 1 };
    const textureB = { id: 'tex-b', width: 1920, height: 1080, uid: 2 };
    compositor.ensureClipRenderTexture = vi
      .fn()
      .mockReturnValueOnce(textureA)
      .mockReturnValueOnce(textureB);
    compositor.renderLowerLayersToTexture = vi.fn();

    const activeAdjustmentLow = {
      itemId: 'adj-low',
      clipKind: 'adjustment',
      layer: 1,
      startUs: 0,
      sprite: { visible: true, texture: null },
      adjustmentSourceTexture: null,
    } as any;
    const activeAdjustmentHigh = {
      itemId: 'adj-high',
      clipKind: 'adjustment',
      layer: 3,
      startUs: 0,
      sprite: { visible: true, texture: null },
      adjustmentSourceTexture: null,
    } as any;
    const inactiveAdjustment = {
      itemId: 'adj-inactive',
      clipKind: 'adjustment',
      layer: 5,
      startUs: 0,
      sprite: { visible: false, texture: { stale: true } },
      adjustmentSourceTexture: null,
    } as any;

    compositor.clips = [inactiveAdjustment, activeAdjustmentHigh, activeAdjustmentLow];

    compositor.prepareAdjustmentClips([activeAdjustmentHigh, activeAdjustmentLow]);

    expect(compositor.ensureClipRenderTexture).toHaveBeenCalledTimes(2);
    expect(compositor.renderLowerLayersToTexture).toHaveBeenNthCalledWith(1, 1, textureA);
    expect(compositor.renderLowerLayersToTexture).toHaveBeenNthCalledWith(2, 3, textureB);
    expect(activeAdjustmentLow.sprite.texture).toBe(textureA);
    expect(activeAdjustmentHigh.sprite.texture).toBe(textureB);
    expect(inactiveAdjustment.sprite.texture).toBeDefined();
    expect(inactiveAdjustment.sprite.texture).not.toEqual({ stale: true });
  });

  it('disables effect padding for adjustment clips', async () => {
    const compositor = new VideoCompositor() as any;
    const applyEffects = vi.fn().mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sourceBitmap = { width: 1920, height: 1080, close: vi.fn() };
    const adjustmentTexture = { id: 'adjustment-texture' };
    const adjustment = {
      itemId: 'adj-blur',
      clipKind: 'adjustment',
      layer: 1,
      startUs: 0,
      sprite: { destroyed: false, visible: true, texture: null },
      adjustmentSourceTexture: null,
      effects: [
        {
          id: 'blur',
          type: 'blur',
          enabled: true,
          strength: 24,
          blurPastEdges: true,
        },
      ],
    } as any;

    compositor.width = 1920;
    compositor.height = 1080;
    compositor.previewEffectsEnabled = true;
    compositor.computeRunner = { isReady: () => true, applyEffects };
    compositor.app = { renderer: { render: vi.fn() } };
    compositor.clips = [adjustment];
    compositor.ensureStageTextureRenderer = vi.fn().mockReturnValue({
      renderLowerLayersToBitmap: vi.fn().mockResolvedValue(sourceBitmap),
    });
    compositor.ensureClipRenderTexture = vi.fn().mockReturnValue(adjustmentTexture);

    await compositor.prepareAdjustmentClips([adjustment]);

    expect(applyEffects).toHaveBeenCalledWith(
      sourceBitmap,
      expect.arrayContaining([expect.objectContaining({ type: 'gaussian-blur', bleed: true })]),
      { enablePadding: false },
    );
    expect(sourceBitmap.close).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('normalizes background color when updating solid clips in updateTimelineLayout', async () => {
    const compositor = new VideoCompositor() as any;
    compositor.width = 1920;
    compositor.height = 1080;
    compositor.syncTrackRuntimes = vi.fn();
    compositor.rebuildPrevClipIndex = vi.fn();
    compositor.activeTracker = { reset: vi.fn() };
    compositor.getTrackRuntimeForClip = () => null;
    compositor.transitionFilters = new Map();

    const clip = {
      itemId: 'bg1',
      startUs: 0,
      endUs: 1000,
      durationUs: 1000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 1000,
      sourceDurationUs: 1000,
      layer: 0,
      trackId: 'track_0',
      clipKind: 'solid',
      backgroundColor: '#000000',
      sprite: {
        tint: 0,
        parent: null,
        anchor: { set: vi.fn() },
        scale: { x: 1, y: 1 },
        width: 1,
        height: 1,
        rotation: 0,
        x: 0,
        y: 0,
      },
      imageSource: { width: 1920, height: 1080 },
      effectFilters: new Map(),
    } as any;

    compositor.clips = [clip];

    await compositor.updateTimelineLayout([
      {
        kind: 'clip',
        id: 'bg1',
        trackId: 'track_0',
        layer: 0,
        clipType: 'background',
        backgroundColor: 'abc',
        timelineRange: { startUs: 0, durationUs: 1000 },
        sourceRange: { startUs: 0, durationUs: 1000 },
      },
    ]);

    expect(clip.backgroundColor).toBe('#aabbcc');
    expect(clip.sprite.tint).toBe(0xaabbcc);
  });
});
