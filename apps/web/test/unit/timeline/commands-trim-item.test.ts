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
          sourceDurationTicks: 1_270_080_000_000,
          sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: 2_540_160_000_000, // try to extend far beyond the 5s source
    });

    const c1 = findClip(next, 'c1');
    // 2s of remaining material → 3s + 2s, never 13s.
    expect(c1.timelineRange.durationTicks).toBe(1_270_080_000_000);
    expect(c1.sourceRange.durationTicks).toBe(1_270_080_000_000);
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
          sourceDurationTicks: 1_016_064_000_000,
          sourceRange: { startTicks: 0, durationTicks: 508_032_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 508_032_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'a1',
      itemId: 'ac1',
      edge: 'end',
      deltaTicks: 2_540_160_000_000,
    });

    const ac1 = findClip(next, 'ac1');
    expect(ac1.timelineRange.durationTicks).toBe(1_016_064_000_000);
    expect(ac1.sourceRange.durationTicks).toBe(1_016_064_000_000);
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
          sourceDurationTicks: 0,
          sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: 2_540_160_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(Number.isFinite(c1.timelineRange.durationTicks)).toBe(true);
    expect(Number.isFinite(c1.sourceRange.durationTicks)).toBe(true);
    // Cannot grow past what is already consumed until the duration is known.
    expect(c1.timelineRange.durationTicks).toBe(762_048_000_000);
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
          sourceDurationTicks: 762_048_000_000,
          sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'img1',
      edge: 'end',
      deltaTicks: 1_270_080_000_000,
    });

    const img1 = findClip(next, 'img1');
    expect(img1.timelineRange.durationTicks).toBe(2_032_128_000_000);
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
          sourceDurationTicks: 762_048_000_000,
          sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'img1',
      edge: 'end',
      deltaTicks: -254_016_000_000,
    });

    const img1 = findClip(next, 'img1');
    expect(img1.timelineRange.durationTicks).toBe(508_032_000_000);
    expect(img1.sourceRange).toEqual({ startTicks: 0, durationTicks: 508_032_000_000 });
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
          sourceDurationTicks: 2_540_160_000_000,
          // 2s of unused material before the in-point.
          sourceRange: {
            startTicks: 508_032_000_000,
            durationTicks: 762_048_000_000,
          },
          timelineRange: {
            startTicks: 1_270_080_000_000,
            durationTicks: 762_048_000_000,
          },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'start',
      deltaTicks: -2_540_160_000_000, // drag the start far to the left
    });

    const c1 = findClip(next, 'c1');
    // Only 2s of head material exists, so the clip grows by exactly 2s.
    expect(c1.sourceRange.startTicks).toBe(0);
    expect(c1.timelineRange.startTicks).toBe(762_048_000_000);
    expect(c1.timelineRange.durationTicks).toBe(1_270_080_000_000);
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
          sourceDurationTicks: 1_270_080_000_000,
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: -508_032_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationTicks).toBe(254_016_000_000);
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
          sourceDurationTicks: 1_270_080_000_000,
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: -508_032_000_000, // shrink past zero
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationTicks).toBe(254_016_000_000);
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
          sourceDurationTicks: 1_270_080_000_000,
          sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
          speed: 1,
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: 2_540_160_000_000,
    });

    const c1 = findClip(next, 'c1');
    expect(c1.timelineRange.durationTicks).toBe(1_270_080_000_000);
    expect(c1.sourceRange.durationTicks).toBe(1_270_080_000_000);
  });
});
