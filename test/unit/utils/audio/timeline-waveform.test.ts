import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import {
  buildTimelinePeaks,
  clearComposedTimelinePeaksCache,
  getCachedComposedTimelinePeaks,
  setCachedComposedTimelinePeaks,
} from '~/utils/audio/timeline-waveform';
import { timelineTicks } from '../timeline-time';

function createMediaClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    clipType: 'media',
    name: 'Clip',
    timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
    sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
    sourceDurationTicks: timelineTicks(1_000_000),
    source: { path: 'audio.wav' },
    speed: 1,
    audioGain: 1,
    ...overrides,
  } as TimelineClipItem;
}

function createDocument(items: TimelineClipItem[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'timeline-1',
    name: 'Timeline',
    timebase: { fps: 25 },
    tracks: [
      {
        id: 'track-1',
        kind: 'audio',
        name: 'Audio',
        items,
      },
    ],
  };
}

describe('timeline waveform peaks', () => {
  it('builds mixed timeline peaks using injected media peak loader', async () => {
    const ensureMediaPeaks = vi.fn(async () => [new Float32Array([0.2, 0.6])]);

    const peaks = await buildTimelinePeaks({
      doc: createDocument([createMediaClip({ audioGain: 2 })]),
      durationTicks: timelineTicks(1_000_000),
      maxLength: 2,
      visiting: new Set<string>(),
      ensureMediaPeaks,
      loadTimelineDocument: vi.fn(),
      yieldEverySamples: 10_000,
    });

    expect(ensureMediaPeaks).toHaveBeenCalledWith({
      path: 'audio.wav',
      maxLength: 2,
      durationS: 1,
      shouldCancel: undefined,
    });
    expect(peaks?.[0]?.[0]).toBeCloseTo(0.4);
    expect(peaks?.[0]?.[1]).toBeCloseTo(1);
  });

  it('recurses into a nested timeline clip and mixes its composed peaks', async () => {
    const ensureMediaPeaks = vi.fn(async () => [new Float32Array(8).fill(0.5)]);

    const nestedDoc = createDocument([
      createMediaClip({ id: 'inner', source: { path: 'audio.wav' } }),
    ]);
    const loadTimelineDocument = vi.fn(async (path: string) =>
      path === 'nested.otio' ? nestedDoc : null,
    );

    const parentDoc = createDocument([
      createMediaClip({
        id: 'outer',
        clipType: 'timeline',
        source: { path: 'nested.otio' },
      }) as TimelineClipItem,
    ]);

    const peaks = await buildTimelinePeaks({
      doc: parentDoc,
      durationTicks: timelineTicks(1_000_000),
      maxLength: 4,
      visiting: new Set<string>(),
      timelinePath: 'root.otio',
      docCache: new Map(),
      getMediaDurationTicks: () => timelineTicks(1_000_000),
      ensureMediaPeaks,
      loadTimelineDocument,
      yieldEverySamples: 10_000,
    });

    // The nested timeline is loaded exactly once and its (constant 0.5) envelope
    // propagates up into the parent mix.
    expect(loadTimelineDocument).toHaveBeenCalledTimes(1);
    expect(loadTimelineDocument).toHaveBeenCalledWith('nested.otio', expect.anything());
    expect(ensureMediaPeaks).toHaveBeenCalled();
    expect(peaks?.[0]?.[0]).toBeCloseTo(0.5);
  });

  it('stops at a circular nested reference instead of recursing forever', async () => {
    const ensureMediaPeaks = vi.fn(async () => [new Float32Array(4).fill(0.5)]);
    const loadTimelineDocument = vi.fn(async () => null);

    const selfReferencingDoc = createDocument([
      createMediaClip({
        id: 'self',
        clipType: 'timeline',
        source: { path: 'root.otio' },
      }) as TimelineClipItem,
    ]);

    const peaks = await buildTimelinePeaks({
      doc: selfReferencingDoc,
      durationTicks: timelineTicks(1_000_000),
      maxLength: 4,
      // The root path is already on the visiting stack, so the self-reference
      // must be skipped.
      visiting: new Set<string>(['root.otio']),
      timelinePath: 'root.otio',
      docCache: new Map(),
      ensureMediaPeaks,
      loadTimelineDocument,
      yieldEverySamples: 10_000,
    });

    expect(loadTimelineDocument).not.toHaveBeenCalled();
    expect(peaks).toBeNull();
  });
});

describe('composed timeline peaks cache', () => {
  beforeEach(() => {
    clearComposedTimelinePeaksCache();
  });

  it('returns the cached envelope for a matching key and resolution', () => {
    const peaks = [new Float32Array([0.3, 0.7])];
    setCachedComposedTimelinePeaks('a@1', 2, peaks);
    expect(getCachedComposedTimelinePeaks('a@1', 2)).toBe(peaks);
  });

  it('reuses a higher-resolution cache for a smaller request but not vice versa', () => {
    const peaks = [new Float32Array([0.1, 0.2, 0.3, 0.4])];
    setCachedComposedTimelinePeaks('a@1', 4, peaks);
    // Requesting fewer bins than cached is fine (rendering resamples).
    expect(getCachedComposedTimelinePeaks('a@1', 2)).toBe(peaks);
    // Requesting more resolution than cached must miss so it gets recomputed.
    expect(getCachedComposedTimelinePeaks('a@1', 8)).toBeNull();
  });

  it('does not cache empty (zero-length) envelopes', () => {
    setCachedComposedTimelinePeaks('empty@1', 2, [new Float32Array(0)]);
    expect(getCachedComposedTimelinePeaks('empty@1', 2)).toBeNull();
  });

  it('evicts the oldest entry once the cache limit is exceeded', () => {
    const LIMIT = 32;
    for (let i = 0; i < LIMIT + 1; i++) {
      setCachedComposedTimelinePeaks(`k${i}@1`, 1, [new Float32Array([0.5])]);
    }
    // The very first key should have been evicted; the last one survives.
    expect(getCachedComposedTimelinePeaks('k0@1', 1)).toBeNull();
    expect(getCachedComposedTimelinePeaks(`k${LIMIT}@1`, 1)).not.toBeNull();
  });
});
