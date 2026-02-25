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
  it('move_item_to_track on same track behaves like move_item (does not remove clip)', () => {
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
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'move_item_to_track',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startUs: 2_000_000,
    });

    const track = next.tracks[0] as TimelineTrack;
    const clip = track.items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1');

    expect(clip).toBeTruthy();
    expect(clip.timelineRange.startUs).toBe(2_000_000);
  });

  it('does not create a gap when moving clip to abut previous clip with rounding noise', () => {
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
          timelineRange: { startUs: 0, durationUs: 999_999 },
          sourceRange: { startUs: 0, durationUs: 999_999 },
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

    const moved = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startUs: 1_000_000 + 1,
    }).next;

    const items = moved.tracks[0].items;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');
    expect(gaps.length).toBe(0);

    const c1 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1') as any;
    const c2 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c2') as any;
    const endC1 = c1.timelineRange.startUs + c1.timelineRange.durationUs;
    expect(c2.timelineRange.startUs).toBe(endC1);
  });

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

  it('quantizes to frames and avoids micro-gaps (fps=30)', () => {
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
          timelineRange: { startUs: 1_000_001, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const moved = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startUs: 1_000_001,
    }).next;

    const items = moved.tracks[0].items;
    const c1 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1') as any;
    const c2 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c2') as any;
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    const endC1 = c1.timelineRange.startUs + c1.timelineRange.durationUs;
    expect(c2.timelineRange.startUs).toBeGreaterThanOrEqual(0);

    // No micro-gaps: either abuts or has a full gap item.
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');
    if (gaps.length === 0) {
      expect(c2.timelineRange.startUs).toBe(endC1);
    } else {
      expect(gaps[0]?.timelineRange.durationUs).toBeGreaterThan(0);
    }
  });

  it('trim end supports negative deltas and stays frame-accurate', () => {
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
      ],
    });

    const trimmed = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: -123_456,
    }).next;

    const c1 = trimmed.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1',
    ) as any;
    expect(c1.timelineRange.durationUs).toBeGreaterThan(0);
    // Frame accurate at 30 fps: durationUs should be stable under frame round-trip quantization.
    const fps = 30;
    const frames = Math.round((c1.timelineRange.durationUs * fps) / 1_000_000);
    const reconstructedUs = Math.round((frames * 1_000_000) / fps);
    expect(c1.timelineRange.durationUs).toBe(reconstructedUs);
  });

  it('allows extending virtual clips beyond initial duration (no max clamp)', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'background',
          id: 'b1',
          trackId: 'v1',
          name: 'Background',
          backgroundColor: '#000000',
          timelineRange: { startUs: 0, durationUs: 5_000_000 },
          sourceRange: { startUs: 0, durationUs: 5_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'b1',
      edge: 'end',
      deltaUs: 20_000_000,
    });

    const b1 = next.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && (x as any).id === 'b1',
    ) as any;

    expect(b1).toBeTruthy();
    expect(b1.timelineRange.durationUs).toBeGreaterThan(5_000_000);
  });
});
