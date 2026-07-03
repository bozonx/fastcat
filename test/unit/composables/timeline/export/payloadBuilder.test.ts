import { beforeEach, describe, expect, it } from 'vitest';
import {
  assignLayerBands,
  buildVideoWorkerPayloadFromTracks,
  buildWorkerVideoTracks,
  clearNestedDocCacheForTests,
  getNestedClipWindow,
  mergeNestedClipSpeed,
  trimNestedClipToParentWindow,
  trimWorkerClipToRange,
} from '~/composables/timeline/export/payloadBuilder';
import { serializeTimelineToOtio } from '~/timeline/otio-serializer';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

function track(overrides: Record<string, unknown> = {}): any {
  return {
    id: 't',
    kind: 'video',
    opacity: 1,
    blendMode: 'normal',
    effects: [],
    items: [],
    ...overrides,
  };
}

function workerClip(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'c',
    timelineRange: { startUs: 0, durationUs: 10_000_000 },
    sourceRange: { startUs: 0, durationUs: 10_000_000 },
    speed: 1,
    ...overrides,
  };
}

describe('buildWorkerVideoTracks', () => {
  it('keeps only visible video tracks', () => {
    const result = buildWorkerVideoTracks([
      track({ id: 'v1' }),
      track({ id: 'a1', kind: 'audio' }),
      track({ id: 'v2', videoHidden: true }),
      track({ id: 'v3' }),
    ]);
    expect(result.map((t) => t.id)).toEqual(['v1', 'v3']);
  });

  it('assigns descending layer indices so the first track renders on top', () => {
    const result = buildWorkerVideoTracks([track({ id: 'v1' }), track({ id: 'v2' })]);
    // First track in document order gets the highest layer value.
    expect(result).toEqual([
      expect.objectContaining({ id: 'v1', layer: 1 }),
      expect.objectContaining({ id: 'v2', layer: 0 }),
    ]);
  });

  it('forwards opacity/blendMode/effects', () => {
    const effects = [{ type: 'blur' }];
    const [out] = buildWorkerVideoTracks([
      track({ id: 'v1', opacity: 0.5, blendMode: 'screen', effects }),
    ]);
    expect(out).toMatchObject({ opacity: 0.5, blendMode: 'screen', effects });
  });
});

describe('buildVideoWorkerPayloadFromTracks', () => {
  it('produces a video clip for a text-only timeline', async () => {
    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        track({
          id: 'v1',
          items: [
            {
              id: 'text-1',
              kind: 'clip',
              clipType: 'text',
              trackId: 'v1',
              text: 'Hello',
              style: { width: 720, fontSize: 96, color: '#ffffff' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        }),
      ],
      projectStore: {
        projectSettings: {
          project: {
            width: 1920,
            height: 1080,
            fps: 30,
            audioDeclickDurationUs: 0,
          },
        },
      } as never,
      workspaceStore: {
        userSettings: {
          projectDefaults: {
            defaultAudioFadeCurve: 'linear',
          },
        },
      } as never,
    });

    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({
      id: 'text-1',
      clipType: 'text',
      text: 'Hello',
    });
  });

  it('keeps track opacity and blend separate from clip properties', async () => {
    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        track({
          id: 'v1',
          opacity: 0.5,
          blendMode: 'screen',
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              clipType: 'media',
              trackId: 'v1',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              opacity: 0.8,
              blendMode: 'multiply',
            },
          ],
        }),
      ],
      projectStore: {
        projectSettings: {
          project: {
            width: 1920,
            height: 1080,
            fps: 30,
            audioDeclickDurationUs: 0,
          },
        },
      } as never,
      workspaceStore: {
        userSettings: {
          projectDefaults: {
            defaultAudioFadeCurve: 'linear',
          },
        },
      } as never,
    });

    expect(result.tracks[0]).toMatchObject({
      id: 'v1',
      opacity: 0.5,
      blendMode: 'screen',
    });
    expect(result.clips[0]).toMatchObject({
      id: 'clip-1',
      opacity: 0.8,
      blendMode: 'multiply',
    });
  });

  it('omits disabled video parameter groups from compositor clips', async () => {
    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        track({
          id: 'v1',
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              clipType: 'media',
              trackId: 'v1',
              source: { path: '_video/source.mp4' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
              opacity: 0.5,
              opacityActive: false,
              blendMode: 'multiply',
              blendModeActive: false,
              transform: { position: { x: 100, y: 200 } },
              transformActive: false,
              sourceOrientation: '90',
              mask: { source: { path: 'mask.png' }, mode: 'alpha' },
              maskActive: false,
            },
          ],
        }),
      ],
      projectStore: {
        projectSettings: {
          project: {
            width: 1920,
            height: 1080,
            fps: 30,
            audioDeclickDurationUs: 0,
          },
        },
      } as never,
      workspaceStore: {
        userSettings: {
          projectDefaults: {
            defaultAudioFadeCurve: 'linear',
          },
        },
      } as never,
    });

    expect(result.clips[0]).toMatchObject({
      id: 'clip-1',
      opacity: undefined,
      blendMode: undefined,
      transform: undefined,
      sourceOrientation: undefined,
      mask: undefined,
    });
  });
});

describe('trimWorkerClipToRange', () => {
  it('returns null when the clip is fully outside the range', () => {
    const clip = workerClip({ timelineRange: { startUs: 0, durationUs: 1_000_000 } });
    expect(trimWorkerClipToRange(clip, { startUs: 5_000_000, endUs: 8_000_000 })).toBeNull();
  });

  it('rebases timelineRange to the range start and trims the source window', () => {
    const clip = workerClip({
      timelineRange: { startUs: 2_000_000, durationUs: 6_000_000 },
      sourceRange: { startUs: 1_000_000, durationUs: 6_000_000 },
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: 3_000_000, endUs: 5_000_000 })!;

    // Overlap is [3s, 5s]; relative to range start (3s) the clip starts at 0.
    expect(trimmed.timelineRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
    // The clip started 1s before the overlap, so source advances by 1s.
    expect(trimmed.sourceRange).toEqual({ startUs: 2_000_000, durationUs: 2_000_000 });
  });

  it('scales the source window by playback speed', () => {
    const clip = workerClip({
      timelineRange: { startUs: 0, durationUs: 4_000_000 },
      sourceRange: { startUs: 0, durationUs: 8_000_000 },
      speed: 2,
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: 1_000_000, endUs: 3_000_000 })!;

    expect(trimmed.timelineRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
    // 1s of trimmed timeline at 2x consumes 2s of source; 2s visible -> 4s source.
    expect(trimmed.sourceRange).toEqual({ startUs: 2_000_000, durationUs: 4_000_000 });
  });

  it('shifts audio fades to compensate for the trimmed-off head/tail', () => {
    const clip = workerClip({
      timelineRange: { startUs: 0, durationUs: 10_000_000 },
      sourceRange: { startUs: 0, durationUs: 10_000_000 },
      audioFadeInUs: 1_000_000,
      audioFadeOutUs: 1_000_000,
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: 2_000_000, endUs: 8_000_000 })!;

    // 2s trimmed from the head fully eats the 1s fade-in (clamped to 0).
    expect(trimmed.audioFadeInUs).toBe(0);
    // 2s trimmed from the tail fully eats the 1s fade-out (clamped to 0).
    expect(trimmed.audioFadeOutUs).toBe(0);
  });
});

function parentTimelineItem(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'parent',
    kind: 'clip',
    clipType: 'timeline',
    timelineRange: { startUs: 0, durationUs: 1000 },
    sourceRange: { startUs: 0, durationUs: 1000 },
    speed: 1,
    ...overrides,
  };
}

describe('getNestedClipWindow', () => {
  it('maps a fully-visible nested clip into parent timeline space', () => {
    const window = getNestedClipWindow({
      nestedClip: workerClip({ timelineRange: { startUs: 0, durationUs: 1000 } }),
      parentItem: parentTimelineItem({ timelineRange: { startUs: 100, durationUs: 1000 } }),
    })!;

    expect(window).toMatchObject({
      overlapStartUs: 0,
      overlapEndUs: 1000,
      parentStartUs: 100,
      parentDurationUs: 1000,
      parentLocalStartUs: 0,
      parentLocalEndUs: 1000,
    });
  });

  it('clips to the parent source window (the parent trims the nested timeline)', () => {
    const window = getNestedClipWindow({
      nestedClip: workerClip({ timelineRange: { startUs: 300, durationUs: 1000 } }),
      // Parent only exposes nested-local [200, 700).
      parentItem: parentTimelineItem({
        timelineRange: { startUs: 100, durationUs: 500 },
        sourceRange: { startUs: 200, durationUs: 500 },
      }),
    })!;

    // Visible overlap is [300, 700) → 400us, offset 100us into the window.
    expect(window).toMatchObject({
      overlapStartUs: 300,
      overlapEndUs: 700,
      parentLocalStartUs: 100,
      parentStartUs: 200,
      parentDurationUs: 400,
    });
  });

  it('compresses the parent duration by the parent speed', () => {
    const window = getNestedClipWindow({
      nestedClip: workerClip({ timelineRange: { startUs: 0, durationUs: 1000 } }),
      parentItem: parentTimelineItem({
        timelineRange: { startUs: 0, durationUs: 500 },
        sourceRange: { startUs: 0, durationUs: 1000 },
        speed: 2,
      }),
    })!;

    // 1000us of nested content played at 2x occupies 500us of parent timeline.
    expect(window.parentDurationUs).toBe(500);
  });

  it('places a head clip at the tail when the parent is reversed', () => {
    const window = getNestedClipWindow({
      // Only the first 400us of the nested timeline.
      nestedClip: workerClip({ timelineRange: { startUs: 0, durationUs: 400 } }),
      parentItem: parentTimelineItem({
        timelineRange: { startUs: 0, durationUs: 1000 },
        sourceRange: { startUs: 0, durationUs: 1000 },
        speed: -1,
      }),
    })!;

    // Reversed: nested [0,400) shows up at the end of the parent.
    expect(window).toMatchObject({
      parentStartUs: 600,
      parentDurationUs: 400,
    });
  });

  it('returns null when the nested clip is outside the parent window', () => {
    const window = getNestedClipWindow({
      nestedClip: workerClip({ timelineRange: { startUs: 500, durationUs: 100 } }),
      parentItem: parentTimelineItem({ sourceRange: { startUs: 0, durationUs: 100 } }),
    });
    expect(window).toBeNull();
  });
});

describe('mergeNestedClipSpeed', () => {
  it('multiplies parent and child speeds', () => {
    expect(
      mergeNestedClipSpeed({
        parentItem: parentTimelineItem({ speed: 2 }),
        nestedClip: workerClip({ speed: 3 }),
      }),
    ).toBe(6);
  });

  it('preserves reversal direction', () => {
    expect(
      mergeNestedClipSpeed({
        parentItem: parentTimelineItem({ speed: -1 }),
        nestedClip: workerClip({ speed: 1 }),
      }),
    ).toBe(-1);
  });

  it('returns undefined when neither side changes speed', () => {
    expect(
      mergeNestedClipSpeed({
        parentItem: parentTimelineItem({ speed: 1 }),
        nestedClip: workerClip({ speed: undefined }),
      }),
    ).toBeUndefined();
  });
});

describe('trimNestedClipToParentWindow', () => {
  it('trims the nested clip and rebases it into parent timeline space', () => {
    const trimmed = trimNestedClipToParentWindow({
      nestedClip: workerClip({
        id: 'n',
        timelineRange: { startUs: 0, durationUs: 2000 },
        sourceRange: { startUs: 0, durationUs: 2000 },
        speed: 1,
      }),
      parentItem: parentTimelineItem({
        timelineRange: { startUs: 1000, durationUs: 1000 },
        sourceRange: { startUs: 0, durationUs: 1000 },
        speed: 1,
      }),
    })!;

    // Parent exposes only the first half of the nested clip, shifted to +1000us.
    expect(trimmed.timelineRange).toEqual({ startUs: 1000, durationUs: 1000 });
    expect(trimmed.sourceRange).toEqual({ startUs: 0, durationUs: 1000 });
    // Both sides play at 1x → merged speed stays 1.
    expect(trimmed.speed).toBe(1);
  });

  it('returns null when there is no overlap', () => {
    expect(
      trimNestedClipToParentWindow({
        nestedClip: workerClip({ timelineRange: { startUs: 5000, durationUs: 100 } }),
        parentItem: parentTimelineItem({ sourceRange: { startUs: 0, durationUs: 100 } }),
      }),
    ).toBeNull();
  });
});

describe('assignLayerBands', () => {
  it('matches the dense layout when every track is a single layer', () => {
    // 3 single-layer tracks -> bottom=0, middle=1, top=2 (top = index 0).
    expect(assignLayerBands([1, 1, 1], 0)).toEqual([2, 1, 0]);
  });

  it('reserves a wide band for a track that flattens to many layers', () => {
    // Track index 1 (bottom in a 2-track stack) needs 3 layers, so it occupies
    // [0,3) and the track above it starts at 3 — never inside that band.
    expect(assignLayerBands([1, 3], 0)).toEqual([3, 0]);
  });

  it('stacks several multi-layer bands without overlap', () => {
    // bottom span 2 -> [0,2); next span 3 -> [2,5); top span 1 -> [5,6).
    expect(assignLayerBands([1, 3, 2], 0)).toEqual([5, 2, 0]);
  });

  it('honours a non-zero base offset', () => {
    expect(assignLayerBands([1, 2], 10)).toEqual([12, 10]);
  });
});

// ---------------------------------------------------------------------------
// Nested-timeline layer reservation (regression for the z-collision that let
// adjustment clips / track ordering above a multi-video-track nested timeline
// leak under its inner tracks).
// ---------------------------------------------------------------------------

const PROJECT_STORE_BASE = {
  projectSettings: {
    project: { width: 1920, height: 1080, fps: 30, audioDeclickDurationUs: 0 },
  },
};

const WORKSPACE_STORE = {
  userSettings: { projectDefaults: { defaultAudioFadeCurve: 'linear' } },
} as never;

function nestedVideoTrack(id: string, overrides: Record<string, unknown> = {}): TimelineTrack {
  return {
    id,
    kind: 'video',
    name: id,
    videoHidden: false,
    items: [
      {
        id: `${id}-clip`,
        kind: 'clip',
        clipType: 'media',
        trackId: id,
        source: { path: `_video/${id}.mp4` },
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      },
    ],
    ...overrides,
  } as TimelineTrack;
}

function nestedDoc(videoTracks: TimelineTrack[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'nested-doc',
    name: 'nested',
    timebase: { fps: 30 },
    tracks: videoTracks,
    metadata: { fastcat: { version: 1, docId: 'nested-doc', timebase: { fps: 30 } } },
  };
}

/** A projectStore whose getFileByPath serves one OTIO doc for any `.otio` path. */
function projectStoreServing(doc: TimelineDocument): never {
  const otio = serializeTimelineToOtio(doc);
  return {
    ...PROJECT_STORE_BASE,
    getFileByPath: async (path: string) =>
      path.endsWith('.otio') ? new File([otio], 'nested.otio') : null,
  } as never;
}

function parentTracksWithAdjustmentAboveNested(): TimelineTrack[] {
  return [
    // index 0 = topmost track: an adjustment clip that must sit above the whole
    // nested block below it.
    {
      id: 'adjust-track',
      kind: 'video',
      name: 'adjust',
      videoHidden: false,
      items: [
        {
          id: 'adjustment-1',
          kind: 'clip',
          clipType: 'adjustment',
          trackId: 'adjust-track',
          effects: [{ type: 'blur' }],
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    } as TimelineTrack,
    // index 1 = bottom track: the nested-timeline clip.
    {
      id: 'nest-track',
      kind: 'video',
      name: 'nest',
      videoHidden: false,
      items: [
        {
          id: 'nested-1',
          kind: 'clip',
          clipType: 'timeline',
          trackId: 'nest-track',
          source: { path: '_timelines/nested.otio' },
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    } as TimelineTrack,
  ];
}

describe('nested-timeline layer reservation', () => {
  beforeEach(() => clearNestedDocCacheForTests());

  it('keeps an adjustment track strictly above every layer of a multi-track nested timeline', async () => {
    const doc = nestedDoc([nestedVideoTrack('v3'), nestedVideoTrack('v2'), nestedVideoTrack('v1')]);

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: parentTracksWithAdjustmentAboveNested(),
      projectStore: projectStoreServing(doc),
      workspaceStore: WORKSPACE_STORE,
    });

    const adjustClip = result.clips.find((c) => c.id === 'adjustment-1')!;
    const nestedClips = result.clips.filter((c) => c.id.startsWith('nested-1_nested_'));

    // The nested timeline produced one inner clip per inner video track.
    expect(nestedClips).toHaveLength(3);
    // Every flattened nested layer is strictly below the adjustment clip, so the
    // adjustment (which composites everything under its layer) covers them all.
    for (const nested of nestedClips) {
      expect(nested.layer).toBeLessThan(adjustClip.layer);
    }
    // The inner layers form a contiguous band that never reaches the adjustment.
    const nestedLayers = nestedClips.map((c) => c.layer).sort((a, b) => a - b);
    expect(nestedLayers).toEqual([0, 1, 2]);
    expect(adjustClip.layer).toBe(3);
  });

  it('preserves inner track stacking order inside the reserved band', async () => {
    const doc = nestedDoc([
      nestedVideoTrack('top'),
      nestedVideoTrack('mid'),
      nestedVideoTrack('bottom'),
    ]);

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: parentTracksWithAdjustmentAboveNested(),
      projectStore: projectStoreServing(doc),
      workspaceStore: WORKSPACE_STORE,
    });

    const layerOf = (innerTrack: string) =>
      result.clips.find((c) => c.id === `nested-1_nested_${innerTrack}-clip`)!.layer;

    // Document order is top-to-bottom, so the first inner track renders highest.
    expect(layerOf('top')).toBeGreaterThan(layerOf('mid'));
    expect(layerOf('mid')).toBeGreaterThan(layerOf('bottom'));
  });

  it('still places the adjustment above a single-track nested timeline', async () => {
    const doc = nestedDoc([nestedVideoTrack('only')]);

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: parentTracksWithAdjustmentAboveNested(),
      projectStore: projectStoreServing(doc),
      workspaceStore: WORKSPACE_STORE,
    });

    const adjustClip = result.clips.find((c) => c.id === 'adjustment-1')!;
    const nested = result.clips.find((c) => c.id === 'nested-1_nested_only-clip')!;
    expect(nested.layer).toBeLessThan(adjustClip.layer);
  });

  it('propagates the outer track effect into the nested sub-track containers', async () => {
    const doc = nestedDoc([nestedVideoTrack('inner')]);
    const tracks = parentTracksWithAdjustmentAboveNested();
    // Give the nested clip's own track an effect; it must reach the flattened
    // sub-track so the compositor applies it to the nested content.
    (tracks[1] as TimelineTrack).effects = [{ type: 'sharpen' } as never];

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks,
      projectStore: projectStoreServing(doc),
      workspaceStore: WORKSPACE_STORE,
    });

    const nestedSubTrack = result.tracks.find((t) => t.id.includes('::nested-1::'));
    expect(nestedSubTrack).toBeDefined();
    expect(nestedSubTrack!.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'sharpen' })]),
    );
  });
});
