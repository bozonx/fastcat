// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { VideoCompositor } from '../../src/utils/video-editor/VideoCompositor';

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

  it('does not mark text clip dirty when style values are unchanged', () => {
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
    compositor.updateTimelineLayout([
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

  it('reapplies sprite layout immediately when transform changes in updateTimelineLayout', () => {
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
      },
    ];

    compositor.updateTimelineLayout([
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

  it('recreates invalid shader transition filter when resources are missing', async () => {
    const compositor = new VideoCompositor() as any;
    const recreatedFilter = { resources: {}, destroyed: false };
    const createFilter = vi.fn(() => recreatedFilter);
    const updateFilter = vi.fn();
    const invalidFilter = {
      resources: null,
      destroyed: false,
      destroy: vi.fn(),
    };
    const clip = {
      itemId: 'clip-1',
      startUs: 0,
      endUs: 1_000,
      durationUs: 1_000,
      layer: 1,
      blendMode: 'normal',
      sprite: { visible: true },
      transitionIn: {
        type: 'fade-to-black',
        durationUs: 1_000,
        mode: 'fade',
        curve: 'linear',
        params: {},
      },
      transitionFilter: invalidFilter,
      transitionFilterType: 'fade-to-black',
      transitionSprite: null,
      transitionFromTexture: { source: {} },
      transitionToTexture: { source: {} },
      transitionOutputTexture: {},
    } as any;

    compositor.clips = [clip];
    compositor.transitionFilters = new Map([['clip-1', invalidFilter]]);
    compositor.filterQuadSprite = {
      texture: null,
      scale: { set: vi.fn() },
      width: 0,
      height: 0,
      filters: null,
      x: 0,
      y: 0,
      anchor: { set: vi.fn() },
    };
    compositor.app = {
      renderer: {
        render: vi.fn(),
      },
    };
    compositor.ensureTransitionRenderTexture = vi.fn((texture) => texture ?? { source: {} });
    compositor.renderSingleClipToTexture = vi.fn();
    compositor.renderLowerLayersToTexture = vi.fn();
    compositor.ensureTransitionSprite = vi.fn(() => ({
      texture: null,
      scale: { set: vi.fn() },
      width: 0,
      height: 0,
      alpha: 1,
      blendMode: 'normal',
      filters: null,
      visible: false,
    }));
    compositor.getActiveTransitionState = vi.fn(() => ({
      progress: 0.25,
      curve: 'linear',
      transition: clip.transitionIn,
      manifest: {
        renderMode: 'shader',
        createFilter,
        updateFilter,
      },
    }));

    await expect(compositor.applyShaderTransitions([clip], 250)).resolves.toBeUndefined();
    expect(invalidFilter.destroy).toHaveBeenCalledTimes(1);
    expect(createFilter).toHaveBeenCalledTimes(1);
    expect(updateFilter).toHaveBeenCalledWith(
      recreatedFilter,
      expect.objectContaining({ progress: 0.25 }),
    );
    expect(compositor.filterQuadSprite.filters).toEqual([recreatedFilter]);
    expect(clip.transitionFilter).toBe(recreatedFilter);
  });
});
