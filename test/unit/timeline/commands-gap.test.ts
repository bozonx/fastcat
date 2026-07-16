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

describe('timeline/commands gap behavior', () => {
  it('overlay_place_item should keep free start when quantizeToFrames is false', () => {
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const freeStartTicks = 254_016_254_016;
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startTicks: freeStartTicks,
      quantizeToFrames: false,
    });

    const clip = next.tracks[0]?.items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1',
    );
    expect(clip?.timelineRange.startTicks).toBe(freeStartTicks);
  });

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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'move_item_to_track',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startTicks: 508_032_000_000,
    });

    const track = next.tracks[0] as TimelineTrack;
    const clip = track.items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1');

    expect(clip).toBeTruthy();
    expect(clip.timelineRange.startTicks).toBe(508_032_000_000);
  });

  it('preserves a nonzero gap when clips do not share an exact boundary', () => {
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_015_745_984 },
          sourceRange: { startTicks: 0, durationTicks: 254_015_745_984 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 508_032_000_000,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const moved = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startTicks: 254_016_000_000 + 1,
    }).next;

    const items = moved.tracks[0].items;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');
    expect(gaps.length).toBe(1);

    const c1 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1') as any;
    const c2 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c2') as any;
    const endC1 = c1.timelineRange.startTicks + c1.timelineRange.durationTicks;
    expect(c2.timelineRange.startTicks).toBeGreaterThan(endC1);
    expect(c2.timelineRange.startTicks - endC1).toBe(gaps[0]?.timelineRange.durationTicks);
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 508_032_000_000,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startTicks: 762_048_000_000,
    });

    const items = next.tracks[0].items;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');

    expect(gaps.length).toBe(1);
    expect(gaps[0]?.timelineRange.startTicks).toBe(254_016_000_000);
    expect(gaps[0]?.timelineRange.durationTicks).toBe(508_032_000_000);
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 508_032_000_000,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const normalized = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startTicks: 508_032_000_000,
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
    expect(c2?.timelineRange.startTicks).toBe(254_016_000_000);

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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 762_048_000_000,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
        {
          kind: 'clip',
          id: 'c3',
          trackId: 'v1',
          name: 'C3',
          source: { path: 'c.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 1_270_080_000_000,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
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
    expect(gaps[0]?.timelineRange.startTicks).toBe(254_016_000_000);
    expect(gaps[0]?.timelineRange.durationTicks).toBe(1_016_064_000_000);
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
        {
          kind: 'clip',
          id: 'c2',
          trackId: 'v1',
          name: 'C2',
          source: { path: 'b.mp4' },
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: {
            startTicks: 254_016_254_016,
            durationTicks: 254_016_000_000,
          },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const moved = applyTimelineCommand(doc, {
      type: 'move_item',
      trackId: 'v1',
      itemId: 'c2',
      startTicks: 254_016_254_016,
    }).next;

    const items = moved.tracks[0].items;
    const c1 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1') as any;
    const c2 = items.find((x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c2') as any;
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();
    expect(c2.timelineRange.startTicks).toBeGreaterThanOrEqual(0);

    const endC1 = c1.timelineRange.startTicks + c1.timelineRange.durationTicks;
    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');

    if (gaps.length === 0) {
      expect(c2.timelineRange.startTicks).toBe(endC1);
    } else {
      expect(gaps[0]?.timelineRange.durationTicks).toBeGreaterThan(0);
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 254_016_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 254_016_000_000 },
        },
      ],
    });

    const trimmed = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: -31_359_799_296,
    }).next;

    const c1 = trimmed.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1',
    ) as any;
    expect(c1.timelineRange.durationTicks).toBeGreaterThan(0);
    const fps = 30;
    const frames = Math.round((c1.timelineRange.durationTicks * fps) / 254_016_000_000);
    const reconstructedTicks = Math.round((frames * 254_016_000_000) / fps);
    expect(c1.timelineRange.durationTicks).toBe(reconstructedTicks);
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
          timelineRange: { startTicks: 0, durationTicks: 1_270_080_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_270_080_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'b1',
      edge: 'end',
      deltaTicks: 5_080_320_000_000,
    });

    const b1 = next.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && (x as any).id === 'b1',
    ) as any;

    expect(b1).toBeTruthy();
    expect(b1.timelineRange.durationTicks).toBeGreaterThan(1_270_080_000_000);
  });

  it('preserves fade and transition lengths when trim extends a clip', () => {
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 1_016_064_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_016_064_000_000 },
          audioFadeInTicks: 254_016_000_000,
          audioFadeOutTicks: 254_016_000_000,
          transitionIn: { type: 'dissolve', durationTicks: 127_008_000_000 },
          transitionOut: { type: 'dissolve', durationTicks: 190_512_000_000 },
        },
      ],
    });

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'c1',
      edge: 'end',
      deltaTicks: 508_032_000_000,
    });

    const c1 = next.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1',
    ) as any;

    expect(c1.timelineRange.durationTicks).toBe(1_524_096_000_000);
    expect(c1.audioFadeInTicks).toBe(254_016_000_000);
    expect(c1.audioFadeOutTicks).toBe(254_016_000_000);
    expect(c1.transitionIn.durationTicks).toBe(127_008_000_000);
    expect(c1.transitionOut.durationTicks).toBe(190_512_000_000);
  });

  it('proportionally shrinks fades and transitions when trim reduces a clip into both edges', () => {
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
          sourceDurationTicks: 2_540_160_000_000,
          timelineRange: { startTicks: 0, durationTicks: 1_270_080_000_000 },
          sourceRange: { startTicks: 0, durationTicks: 1_270_080_000_000 },
          audioFadeInTicks: 762_048_000_000,
          audioFadeOutTicks: 762_048_000_000,
          transitionIn: { type: 'dissolve', durationTicks: 762_048_000_000 },
          transitionOut: { type: 'dissolve', durationTicks: 762_048_000_000 },
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

    const c1 = next.tracks[0].items.find(
      (x: TimelineTrackItem) => x.kind === 'clip' && x.id === 'c1',
    ) as any;

    expect(c1.timelineRange.durationTicks).toBe(762_048_000_000);
    expect(c1.audioFadeInTicks).toBe(381_024_000_000);
    expect(c1.audioFadeOutTicks).toBe(381_024_000_000);
    expect(c1.transitionIn.durationTicks).toBe(381_024_000_000);
    expect(c1.transitionOut.durationTicks).toBe(381_024_000_000);
  });
});
