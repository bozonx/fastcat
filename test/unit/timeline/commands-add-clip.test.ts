/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { timelineUs } from '../utils/timeline-time';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineClipItem } from '~/timeline/types';

function createDoc(fps = 29.97): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps },
    tracks: [{ id: 'v1', kind: 'video', name: 'Video 1', items: [] }],
  };
}

describe('timeline/commands add clip', () => {
  it('clamps source range to the source duration after frame quantization', () => {
    const result = applyTimelineCommand(createDoc(), {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'Clip',
      path: '_video/clip.mp4',
      startUs: 0,
      durationUs: timelineUs(1_017_685),
      sourceDurationUs: timelineUs(1_017_685),
    }).next;

    const clip = result.tracks[0]?.items[0] as TimelineClipItem;

    expect(clip.timelineRange.durationUs).toBeGreaterThan(clip.sourceDurationUs ?? 0);
    expect(clip.sourceRange).toEqual({ startUs: 0, durationUs: timelineUs(1_017_685) });
  });

  it('clamps explicit source range start and duration to the available source tail', () => {
    const result = applyTimelineCommand(createDoc(30), {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'Clip',
      path: '_video/clip.mp4',
      startUs: 0,
      durationUs: timelineUs(1_000_000),
      sourceDurationUs: timelineUs(3_000_000),
      sourceRange: { startUs: timelineUs(2_500_000), durationUs: timelineUs(1_000_000) },
    }).next;

    const clip = result.tracks[0]?.items[0] as TimelineClipItem;

    expect(clip.sourceRange).toEqual({
      startUs: timelineUs(2_500_000),
      durationUs: timelineUs(500_000),
    });
  });
});
