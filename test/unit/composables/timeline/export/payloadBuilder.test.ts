import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assignLayerBands,
  buildVideoWorkerPayload,
  buildVideoWorkerPayloadFromTracks,
  buildWorkerVideoTracks,
  clearNestedDocCacheForTests,
  getNestedClipWindow,
  mergeNestedClipSpeed,
  toWorkerTimelineClips,
  trimNestedClipToParentWindow,
  trimWorkerClipToRange,
} from '~/composables/timeline/export/payloadBuilder';
import { serializeTimelineToOtio } from '~/timeline/otio-serializer';
import type { TimelineDocument, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timelineUs } from '../../../utils/timeline-time';
import { TICKS_PER_SECOND } from '~/utils/time';

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
    timelineRange: { startUs: 0, durationUs: timelineUs(10_000_000) },
    sourceRange: { startUs: 0, durationUs: timelineUs(10_000_000) },
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
              timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
              sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
              timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
              sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
              timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
              sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
    const clip = workerClip({ timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) } });
    expect(trimWorkerClipToRange(clip, { startUs: timelineUs(5_000_000), endUs: timelineUs(8_000_000) })).toBeNull();
  });

  it('rebases timelineRange to the range start and trims the source window', () => {
    const clip = workerClip({
      timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(6_000_000) },
      sourceRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(6_000_000) },
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: timelineUs(3_000_000), endUs: timelineUs(5_000_000) })!;

    // Overlap is [3s, 5s]; relative to range start (3s) the clip starts at 0.
    expect(trimmed.timelineRange).toEqual({ startUs: 0, durationUs: timelineUs(2_000_000) });
    // The clip started 1s before the overlap, so source advances by 1s.
    expect(trimmed.sourceRange).toEqual({ startUs: timelineUs(2_000_000), durationUs: timelineUs(2_000_000) });
  });

  it('scales the source window by playback speed', () => {
    const clip = workerClip({
      timelineRange: { startUs: 0, durationUs: timelineUs(4_000_000) },
      sourceRange: { startUs: 0, durationUs: timelineUs(8_000_000) },
      speed: 2,
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: timelineUs(1_000_000), endUs: timelineUs(3_000_000) })!;

    expect(trimmed.timelineRange).toEqual({ startUs: 0, durationUs: timelineUs(2_000_000) });
    // 1s of trimmed timeline at 2x consumes 2s of source; 2s visible -> 4s source.
    expect(trimmed.sourceRange).toEqual({ startUs: timelineUs(2_000_000), durationUs: timelineUs(4_000_000) });
  });

  it('shifts audio fades to compensate for the trimmed-off head/tail', () => {
    const clip = workerClip({
      timelineRange: { startUs: 0, durationUs: timelineUs(10_000_000) },
      sourceRange: { startUs: 0, durationUs: timelineUs(10_000_000) },
      audioFadeInUs: timelineUs(1_000_000),
      audioFadeOutUs: timelineUs(1_000_000),
    });

    const trimmed = trimWorkerClipToRange(clip, { startUs: timelineUs(2_000_000), endUs: timelineUs(8_000_000) })!;

    // 2s trimmed from the head fully eats the 1s fade-in (clamped to 0).
    expect(trimmed.audioFadeInUs).toBe(0);
    // 2s trimmed from the tail fully eats the 1s fade-out (clamped to 0).
    expect(trimmed.audioFadeOutUs).toBe(0);
  });

  it('partially shifts audio fades that survive a narrower crop', () => {
    const clipped = trimWorkerClipToRange(
      workerClip({
        clipType: 'media',
        source: { path: '/audio.wav' },
        audioFadeInUs: timelineUs(300_000),
        audioFadeOutUs: timelineUs(400_000),
        timelineRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(1_000_000) },
      }),
      { startUs: timelineUs(1_200_000), endUs: timelineUs(1_800_000) },
    );

    // 200us trimmed off the head leaves 100us of the 300us fade-in; 200us off the
    // tail leaves 200us of the 400us fade-out.
    expect(clipped).toMatchObject({
      audioFadeInUs: timelineUs(100_000),
      audioFadeOutUs: timelineUs(200_000),
      timelineRange: { startUs: 0, durationUs: timelineUs(600_000) },
      sourceRange: { startUs: timelineUs(2_200_000), durationUs: timelineUs(600_000) },
    });
  });

  it('trims reversed clips from the source tail', () => {
    const reversed = trimWorkerClipToRange(
      workerClip({
        id: 'reverse',
        speed: -1,
        source: { path: '/video.mp4' },
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(1_000_000) },
      }),
      { startUs: timelineUs(250_000), endUs: timelineUs(750_000) },
    );
    expect(reversed?.sourceRange).toEqual({ startUs: timelineUs(2_250_000), durationUs: timelineUs(500_000) });
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
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
          timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
          timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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

// ---------------------------------------------------------------------------
// buildVideoWorkerPayload emits the flat meta/track/clip item stream consumed by
// the worker (distinct from buildVideoWorkerPayloadFromTracks above).
// ---------------------------------------------------------------------------

describe('buildVideoWorkerPayload', () => {
  it('emits meta, track and clip items', () => {
    const payload = buildVideoWorkerPayload({
      masterEffects: [{ id: 'master-1', type: 'blur', enabled: true, amount: 4 } as any],
      tracks: [
        {
          id: 'v1',
          layer: 2,
          opacity: 0.6,
          blendMode: 'screen',
          effects: [{ id: 'track-1', type: 'blur', enabled: true, amount: 2 } as any],
        },
      ],
      clips: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          layer: 2,
          source: { path: '/video.mp4' },
          timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        },
      ],
    });

    expect(payload).toMatchObject([
      { kind: 'meta' },
      {
        kind: 'track',
        id: 'v1',
        layer: 2,
        opacity: 0.6,
        blendMode: 'screen',
      },
      {
        kind: 'clip',
        id: 'c1',
        trackId: 'v1',
        layer: 2,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// toWorkerTimelineClips flattens document track items (incl. nested timelines)
// into worker clips. Moved here from the retired useTimelineExport monolith.
// ---------------------------------------------------------------------------

describe('toWorkerTimelineClips', () => {
  const wsMock: any = { userSettings: { projectDefaults: { defaultAudioFadeCurve: 'linear' } } };

  beforeEach(() => {
    clearNestedDocCacheForTests();
  });

  it('attaches layer (default 0) and honours an options override', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: timelineUs(1_000_000),
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        audioGain: 1.5,
        audioBalance: -0.25,
        audioFadeInUs: timelineUs(120_000),
        audioFadeOutUs: timelineUs(340_000),
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    expect(await toWorkerTimelineClips(items, projectStoreMock, wsMock)).toMatchObject([
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        layer: 0,
        source: { path: '/video.mp4' },
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        audioGain: 1.5,
        audioBalance: -0.25,
        audioFadeInUs: timelineUs(120_000),
        audioFadeOutUs: timelineUs(340_000),
      },
    ]);

    const nested = await toWorkerTimelineClips(items, projectStoreMock, wsMock, { layer: 3 });
    expect(nested[0]?.layer).toBe(3);
  });

  it('uses default audio parameters in payload when the clip audio block is disabled', async () => {
    const item = {
      kind: 'clip',
      clipType: 'media',
      id: 'c1',
      trackId: 't1',
      name: 'Clip 1',
      source: { path: '/video.mp4' },
      sourceDurationUs: timelineUs(1_000_000),
      timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      audioFadesActive: false,
      audioGain: 0.25,
      audioBalance: -0.5,
      audioFadeInUs: timelineUs(120_000),
      audioFadeOutUs: timelineUs(340_000),
      audioFadeInCurve: 'logarithmic',
      audioFadeOutCurve: 'logarithmic',
      animations: {
        'audio.volume': { keyframes: [{ timeUs: 0, value: 0.25 }] },
        'audio.pan': { keyframes: [{ timeUs: 0, value: -0.5 }] },
        opacity: { keyframes: [{ timeUs: 0, value: 0.75 }] },
      },
    } as any;
    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips([item], projectStoreMock, wsMock);

    expect(clips[0]).toMatchObject({
      audioGain: 1,
      audioBalance: 0,
      originalAudioGain: 1,
      originalAudioBalance: 0,
    });
    expect(clips[0]?.audioFadeInUs).toBeUndefined();
    expect(clips[0]?.audioFadeOutUs).toBeUndefined();
    expect(clips[0]?.audioFadeInCurve).toBeUndefined();
    expect(clips[0]?.audioFadeOutCurve).toBeUndefined();
    expect(clips[0]?.animations?.['audio.volume']).toBeUndefined();
    expect(clips[0]?.animations?.['audio.pan']).toBeUndefined();
    expect(clips[0]?.animations?.opacity).toEqual({ keyframes: [{ timeUs: 0, value: 0.75 }] });
    expect(item.audioGain).toBe(0.25);
    expect(item.audioFadeInUs).toBe(timelineUs(120_000));
  });

  it('serializes HUD frame and masks into video worker payloads', async () => {
    const tracks = [
      {
        id: 'v1',
        kind: 'video',
        items: [
          {
            kind: 'clip',
            clipType: 'hud',
            id: 'hud-1',
            trackId: 'v1',
            name: 'HUD',
            hudType: 'media_frame',
            background: { source: { path: '/background.png' } },
            content: { source: { path: '/content.mp4' } },
            frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
            mask: { source: { path: '/mask.png' }, mode: 'alpha' },
            timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          },
        ],
      },
    ] as any;
    const projectStoreMock = {
      getFileByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const built = await buildVideoWorkerPayloadFromTracks({
      tracks,
      projectStore: projectStoreMock,
      workspaceStore: wsMock,
    });

    expect(built.clips[0]).toMatchObject({
      clipType: 'hud',
      frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
      mask: { source: { path: '/mask.png' }, mode: 'alpha' },
    });

    const legacy = await toWorkerTimelineClips(tracks[0].items, projectStoreMock, wsMock);
    expect(legacy[0]).toMatchObject({
      clipType: 'hud',
      frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
      mask: { source: { path: '/mask.png' }, mode: 'alpha' },
    });
  });

  it('propagates transform', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: timelineUs(1_000_000),
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      } as any,
    ];

    (items[0] as any).transform = {
      scale: { x: 1.25, y: 0.75, linked: false },
      rotationDeg: 10,
      position: { x: 12, y: -34 },
      anchor: { preset: 'center' },
    };

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;
    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips[0]?.transform).toEqual((items[0] as any).transform);
  });

  it('keeps top-level clip compositing separate from track compositing', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 'v1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: timelineUs(1_000_000),
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        opacity: 0.5,
        blendMode: 'multiply',
        effects: [{ id: 'clip-1', type: 'blur', enabled: true, amount: 1 } as any],
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;
    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 3,
      trackKind: 'video',
    });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      id: 'c1',
      trackId: 'v1',
      layer: 3,
      opacity: 0.5,
      blendMode: 'multiply',
    });
    expect(clips[0]?.effects).toEqual([{ id: 'clip-1', type: 'blur', enabled: true, amount: 1 }]);
  });

  it('normalizes background clip colors', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'background',
        id: 'bg1',
        trackId: 't1',
        name: 'Background',
        backgroundColor: 'abc',
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      clipType: 'background',
      backgroundColor: '#aabbcc',
    });
  });

  it('preserves transitions on background clips', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'background',
        id: 'bg1',
        trackId: 't1',
        name: 'Background',
        backgroundColor: '#112233',
        transitionIn: {
          type: 'fade-to-black',
          durationUs: timelineUs(250_000),
          mode: 'background',
          curve: 'linear',
          params: {},
        },
        transitionOut: {
          type: 'dissolve',
          durationUs: timelineUs(250_000),
          mode: 'transparent',
          curve: 'linear',
          params: {},
        },
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips[0]).toMatchObject({
      clipType: 'background',
      transitionIn: {
        type: 'fade-to-black',
        durationUs: timelineUs(250_000),
        mode: 'background',
      },
      transitionOut: {
        type: 'dissolve',
        durationUs: timelineUs(250_000),
        mode: 'transparent',
      },
    });
  });

  it('respects item.layer when options.layer is not provided', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: timelineUs(1_000_000),
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      } as any,
    ];

    (items[0] as any).layer = 5;

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);
    expect(clips[0]?.layer).toBe(5);

    const overridden = await toWorkerTimelineClips(items, projectStoreMock, wsMock, { layer: 2 });
    expect(overridden[0]?.layer).toBe(2);
  });

  it('does not merge parent track effects into clip effects', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: timelineUs(1_000_000),
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        effects: [{ id: 'clip-fx', type: 'brightness', enabled: true, amount: 1.2 } as any],
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const trackFx = [{ id: 'track-fx', type: 'blur', enabled: true, amount: 2 } as any];
    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      parentEffects: trackFx,
    });

    expect(clips[0]?.effects).toEqual([expect.objectContaining({ id: 'clip-fx' })]);
    expect(clips[0]?.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'track-fx' })]),
    );
  });

  it('resolves relative media paths inside a nested timeline', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'Clip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'media/video.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'timeline',
        id: 'nested1',
        trackId: 't1',
        name: 'Nested',
        source: { path: '_timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 1,
      trackKind: 'video',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.clipType).toBe('media');
    expect(clips[0]?.source?.path).toBe('_timelines/media/video.mp4');
    expect(clips[0]?.trackId).toBe('t1::nested1::v1');
  });

  it('reuses a nested document for repeated references within one flattening pass', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [],
          },
        ],
      },
    });
    const getFileByPath = vi.fn(async () => {
      return {
        lastModified: 10,
        text: async () => nestedOtio,
      } as File;
    });
    const projectStoreMock = {
      projectSettings: {
        project: {
          audioDeclickDurationUs: 5000,
          fps: 25,
        },
      },
      getFileByPath,
    } as any;
    const createNestedItem = (id: string, startUs: number) =>
      ({
        kind: 'clip',
        clipType: 'timeline',
        id,
        trackId: 'track',
        name: id,
        source: { path: '_timelines/shared.otio' },
        timelineRange: { startUs, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
      }) as TimelineTrackItem;

    await toWorkerTimelineClips(
      [createNestedItem('nested-1', 0), createNestedItem('nested-2', timelineUs(1_000_000))],
      projectStoreMock,
      wsMock,
      { trackKind: 'video' },
    );

    expect(getFileByPath).toHaveBeenCalledTimes(1);
  });

  it('maps parent nested timeline speed into child clips', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'Clip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'media/video.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 2000000 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'timeline',
        id: 'nested-fast',
        trackId: 't1',
        name: 'Nested Fast',
        source: { path: '_timelines/nested.otio' } as any,
        speed: 2,
        timelineRange: { startUs: timelineUs(5_000_000), durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 1,
      trackKind: 'video',
    });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      speed: 2,
      timelineRange: { startUs: timelineUs(5_000_000), durationUs: timelineUs(1_000_000) },
      sourceRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
    });
  });

  it('stops circular nested timelines after resolving relative paths', async () => {
    const makeNestedOtio = (targetUrl: string) =>
      JSON.stringify({
        OTIO_SCHEMA: 'Timeline.1',
        name: 'nested',
        metadata: { fastcat: { timebase: { fps: 25 } } },
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'V1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'Nested',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: targetUrl,
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                  },
                  metadata: {
                    fastcat: {
                      clipType: 'timeline',
                      source: { durationUs: 1000000 },
                    },
                  },
                },
              ],
            },
          ],
        },
      });

    const requestedPaths: string[] = [];
    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        requestedPaths.push(path);
        if (path === '_timelines/sub/a.otio') {
          return { text: async () => makeNestedOtio('../root.otio') } as any;
        }
        if (path === '_timelines/root.otio') {
          return { text: async () => makeNestedOtio('sub/./a.otio') } as any;
        }
        return null;
      },
    } as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const clips = await toWorkerTimelineClips(
        [
          {
            kind: 'clip',
            clipType: 'timeline',
            id: 'nested-a',
            trackId: 't1',
            name: 'Nested A',
            source: { path: '_timelines/sub/../sub/a.otio' },
            timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          } as any,
        ],
        projectStoreMock,
        wsMock,
        { layer: 1, trackKind: 'video' },
      );

      expect(clips).toEqual([]);
      expect(requestedPaths).toEqual(['_timelines/sub/a.otio', '_timelines/root.otio']);
      expect(warnSpy).toHaveBeenCalledWith(
        '[payloadBuilder]',
        expect.stringContaining('Circular dependency in nested timeline'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies nested timeline parent audio gain/balance/fades when trackKind is audio', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'A1',
            kind: 'Audio',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'AudioClip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'audio.wav',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
                    audio: {
                      gain: 2,
                      balance: 0.1,
                      fadeInUs: 100000,
                      fadeOutUs: 100000,
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'timeline',
        id: 'nested1',
        trackId: 't1',
        name: 'Nested',
        source: { path: '_timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        audioGain: 0.5,
        audioBalance: -0.2,
        audioFadeInUs: timelineUs(200_000),
        audioFadeOutUs: timelineUs(300_000),
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      trackKind: 'audio',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.source?.path).toBe('_timelines/audio.wav');
    expect(clips[0]?.audioGain).toBeCloseTo(1);
    expect(clips[0]?.audioBalance).toBeCloseTo(-0.1);
    expect(clips[0]?.audioFadeInUs).toBe(timelineUs(200_000));
    expect(clips[0]?.audioFadeOutUs).toBe(timelineUs(300_000));
  });

  it('emits explicit nested track payload items with compounded opacity/blend', async () => {
    const workspaceStoreMock = {
      userSettings: {
        projectDefaults: { audioDeclickDurationUs: 5000 },
        optimization: { videoFrameCacheMb: 256 },
      },
    } as any;

    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'NestedV1',
            kind: 'Video',
            metadata: {
              fastcat: {
                video: {
                  opacity: 0.4,
                  blendMode: 'screen',
                },
              },
            },
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'NestedClip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'media/video.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          opacity: 0.5,
          blendMode: 'multiply',
          items: [
            {
              kind: 'clip',
              clipType: 'timeline',
              id: 'nested-1',
              trackId: 'v1',
              name: 'Nested',
              source: { path: '_timelines/nested.otio' },
              timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
              sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            },
          ],
        } as any,
      ],
      projectStore: projectStoreMock,
      workspaceStore: workspaceStoreMock,
    });

    expect(result.tracks).toEqual([
      expect.objectContaining({ id: 'v1', layer: 0, opacity: 0.5, blendMode: 'multiply' }),
      expect.objectContaining({
        id: 'v1::nested-1::v1',
        layer: 0,
        // Parent track opacity (0.5) compounds with the inner track opacity (0.4).
        opacity: 0.2,
        blendMode: 'screen',
      }),
    ]);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.id.startsWith('nested-1_nested_')).toBe(true);
    expect(result.clips[0]).toMatchObject({
      trackId: 'v1::nested-1::v1',
      source: { path: '_timelines/media/video.mp4' },
    });
    expect(result.payload.filter((item) => item.kind === 'track')).toHaveLength(2);
  });
});
