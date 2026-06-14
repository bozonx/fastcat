import { describe, expect, it, vi } from 'vitest';

import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { buildTimelinePeaks } from '~/utils/audio/timeline-waveform';

function createMediaClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    clipType: 'media',
    name: 'Clip',
    timelineRange: { startUs: 0, durationUs: 1_000_000 },
    sourceRange: { startUs: 0, durationUs: 1_000_000 },
    sourceDurationUs: 1_000_000,
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
      durationUs: 1_000_000,
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
});
