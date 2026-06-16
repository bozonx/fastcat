import { describe, expect, it } from 'vitest';
import {
  buildWorkerVideoTracks,
  getNestedClipWindow,
  mergeNestedClipSpeed,
  trimNestedClipToParentWindow,
  trimWorkerClipToRange,
} from '~/composables/timeline/export/payloadBuilder';

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
