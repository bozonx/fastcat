import { describe, expect, it } from 'vitest';
import {
  buildWorkerVideoTracks,
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
