// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { StageManager } from '../../src/utils/video-editor/compositor/StageManager';

describe('StageManager', () => {
  it('sorts stage children by track layer and clip children by timeline order', () => {
    const manager = new StageManager();

    const topContainer = {
      __trackId: 'track-top',
      children: [
        { __clipId: 'clip-same-start-b', __clipOrder: 2 },
        { __clipId: 'clip-late', __clipOrder: 0 },
        { __clipId: 'clip-same-start-a', __clipOrder: 1 },
      ],
    } as any;
    const bottomContainer = {
      __trackId: 'track-bottom',
      children: [],
    } as any;

    const tracks = [
      { id: 'track-top', layer: 3, container: topContainer },
      { id: 'track-bottom', layer: 0, container: bottomContainer },
    ] as any[];
    const clipById = new Map([
      ['clip-late', { itemId: 'clip-late', startUs: 2_000, endUs: 4_000 }],
      ['clip-same-start-a', { itemId: 'clip-same-start-a', startUs: 1_000, endUs: 3_000 }],
      ['clip-same-start-b', { itemId: 'clip-same-start-b', startUs: 1_000, endUs: 3_000 }],
    ]);
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const app = {
      stage: {
        children: [topContainer, bottomContainer],
      },
    } as any;

    manager.sortStage({
      app,
      tracks: tracks as any,
      getClipById: (clipId) => clipById.get(clipId) as any,
      getTrackById: (trackId) => trackById.get(trackId) as any,
    });

    expect(app.stage.children.map((child: any) => child.__trackId)).toEqual([
      'track-bottom',
      'track-top',
    ]);
    expect(topContainer.children.map((child: any) => child.__clipId)).toEqual([
      'clip-same-start-a',
      'clip-same-start-b',
      'clip-late',
    ]);
  });
});
