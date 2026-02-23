import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineTrackItem } from '~/timeline/types';

function makeDoc(track: TimelineTrack): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [track],
  };
}

describe('timeline/commands gap behavior', () => {
  it('normalizes gaps after move_item (single gap between clips)', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startUs: 3_000_000,
    });

    const items = next.tracks[0].items;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');

    expect(gaps.length).toBe(1);
    expect(gaps[0]?.timelineRange.startUs).toBe(1_000_000);
    expect(gaps[0]?.timelineRange.durationUs).toBe(2_000_000);
  });

  it('deletes gap as ripple delete: shifts items to the left', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const normalized = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startUs: 2_000_000,
    }).next;

    const gap = normalized.tracks[0].items.find((x: TimelineTrackItem) => x.kind === 'gap');
    expect(gap?.kind).toBe('gap');

    const { next } = applyTimelineCommand(normalized, {
      type: 'remove_item',
      trackId: 'v1',
      itemId: String(gap?.id),
    });

    const c2 = next.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c2',
    );
    expect(c2?.timelineRange.startUs).toBe(1_000_000);

    const gapsAfter = next.tracks[0].items.filter((x: TimelineTrackItem) => x.kind === 'gap');
    expect(gapsAfter.length).toBe(0);
  });

  it('deletes clip without creating multiple gaps; recomputes single gap from clips', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 3_000_000, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
        {
          kind: 'clip',
          id: 'c3',
          trackId: 'v1',
          name: 'C3',
          source: { path: 'c.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const { next: afterDelete } = applyTimelineCommand(doc, {
      type: 'remove_item',
      trackId: 'v1',
      itemId: 'c2',
    });

    const items = afterDelete.tracks[0].items;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');

    expect(gaps.length).toBe(1);
    expect(gaps[0]?.timelineRange.startUs).toBe(1_000_000);
    expect(gaps[0]?.timelineRange.durationUs).toBe(4_000_000);
  });
});
