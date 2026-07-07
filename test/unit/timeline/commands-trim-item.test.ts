/** @vitest-environment node */
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

function findClip(doc: TimelineDocument, id: string) {
  const item = doc.tracks
    .flatMap((t) => t.items)
    .find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === id);
  if (!item || item.kind !== 'clip') throw new Error(`clip ${id} not found`);
  return item;
}

describe('timeline/commands trim_item — source material bounds', () => {
  it('caps a video clip at its source duration when extending the end', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          sourceDurationUs: 5_000_000,
          sourceRange: { startUs: 0, durationUs: 3_000_000 },
          timelineRange: { startUs: 0, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: 10_000_000, // try to extend far beyond the 5s source
    });

    const c1 = findClip(next, 'c1');
    // 2s of remaining material → 3s + 2s, never 13s.
    expect(c1.timelineRange.durationUs).toBe(5_000_000);
    expect(c1.sourceRange.durationUs).toBe(5_000_000);
  });

  it('caps an audio clip at its source duration when extending the end', () => {
    const doc = makeDoc({
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'ac1',
          trackId: 'a1',
          name: 'AC1',
          source: { path: 'a.wav' },
          isImage: false,
          sourceDurationUs: 4_000_000,
          sourceRange: { startUs: 0, durationUs: 2_000_000 },
          timelineRange: { startUs: 0, durationUs: 2_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'a1',
      itemId: 'ac1',
      edge: 'end',
      deltaUs: 10_000_000,
    });

    const ac1 = findClip(next, 'ac1');
    expect(ac1.timelineRange.durationUs).toBe(4_000_000);
    expect(ac1.sourceRange.durationUs).toBe(4_000_000);
  });

  it('refuses to extend a media clip whose source duration is not yet known (no NaN)', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          // Metadata not resolved yet.
          sourceDurationUs: 0,
          sourceRange: { startUs: 0, durationUs: 3_000_000 },
          timelineRange: { startUs: 0, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: 10_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(Number.isFinite(c1.timelineRange.durationUs)).toBe(true);
    expect(Number.isFinite(c1.sourceRange.durationUs)).toBe(true);
    // Cannot grow past what is already consumed until the duration is known.
    expect(c1.timelineRange.durationUs).toBe(3_000_000);
  });

  it('allows an image clip to extend beyond its initial duration (no material limit)', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'img1',
          trackId: 'v1',
          name: 'Image',
          source: { path: 'a.png' },
          isImage: true,
          sourceDurationUs: 3_000_000,
          sourceRange: { startUs: 0, durationUs: 3_000_000 },
          timelineRange: { startUs: 0, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'img1',
      edge: 'end',
      deltaUs: 5_000_000,
    });

    const img1 = findClip(next, 'img1');
    expect(img1.timelineRange.durationUs).toBe(8_000_000);
  });

  it('allows an image clip to shrink without moving source start below zero', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'img1',
          trackId: 'v1',
          name: 'Image',
          source: { path: 'a.png' },
          isImage: true,
          sourceDurationUs: 3_000_000,
          sourceRange: { startUs: 0, durationUs: 3_000_000 },
          timelineRange: { startUs: 0, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'img1',
      edge: 'end',
      deltaUs: -1_000_000,
    });

    const img1 = findClip(next, 'img1');
    expect(img1.timelineRange.durationUs).toBe(2_000_000);
    expect(img1.sourceRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
  });

  it('limits start trim to the available head material', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          sourceDurationUs: 10_000_000,
          // 2s of unused material before the in-point.
          sourceRange: { startUs: 2_000_000, durationUs: 3_000_000 },
          timelineRange: { startUs: 5_000_000, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'start',
      deltaUs: -10_000_000, // drag the start far to the left
    });

    const c1 = findClip(next, 'c1');
    // Only 2s of head material exists, so the clip grows by exactly 2s.
    expect(c1.sourceRange.startUs).toBe(0);
    expect(c1.timelineRange.startUs).toBe(3_000_000);
    expect(c1.timelineRange.durationUs).toBe(5_000_000);
  });

  it('rejects a shrink below one frame instead of producing a zero-length clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          sourceDurationUs: 5_000_000,
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: -2_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationUs).toBe(1_000_000);
  });
});

describe('timeline/commands overlay_trim_item — guards parity with trim_item', () => {
  it('rejects a shrink below one frame instead of producing a zero-length clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          sourceDurationUs: 5_000_000,
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: -2_000_000, // shrink past zero
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationUs).toBe(1_000_000);
  });

  it('caps a video clip at its source duration when extending the end', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          isImage: false,
          sourceDurationUs: 5_000_000,
          sourceRange: { startUs: 0, durationUs: 3_000_000 },
          timelineRange: { startUs: 0, durationUs: 3_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaUs: 10_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationUs).toBe(5_000_000);
    expect(c1.sourceRange.durationUs).toBe(5_000_000);
  });
});
