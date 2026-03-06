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
});
