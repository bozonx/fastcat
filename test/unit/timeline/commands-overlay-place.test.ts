/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineTicks } from '../utils/timeline-time';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack, TimelineTrackItem } from '~/timeline/types';

function makeDoc(tracks: TimelineTrack[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks,
  };
}

function clips(track: { items: TimelineTrackItem[] }) {
  return track.items.filter((x) => x.kind === 'clip') as any[];
}

describe('timeline/commands overlay_place_item', () => {
  it('moves clip to empty area without affecting others', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c1',
            trackId: 'v1',
            name: 'C1',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c2',
            trackId: 'v1',
            name: 'C2',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(3_000_000), durationTicks: timelineTicks(1_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startTicks: timelineTicks(5_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);
    expect(resultClips.length).toBe(2);

    const movedClip = resultClips.find((x) => x.id === 'c1');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startTicks).toBe(timelineTicks(5_000_000));

    const otherClip = resultClips.find((x) => x.id === 'c2');
    expect(otherClip).toBeTruthy();
    expect(otherClip.timelineRange.startTicks).toBe(timelineTicks(3_000_000));
  });

  it('deletes a clip fully covered by the placed clip', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'big',
            trackId: 'v1',
            name: 'Big',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(5_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'small',
            trackId: 'v1',
            name: 'Small',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(7_000_000), durationTicks: timelineTicks(500_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(500_000) },
          },
        ],
      },
    ]);

    // Place 'big' at 6_000_000 — it will cover 'small' (7_000_000–7_500_000)
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'big',
      startTicks: timelineTicks(6_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const smallClip = resultClips.find((x) => x.id === 'small');
    expect(smallClip).toBeUndefined();

    const movedClip = resultClips.find((x) => x.id === 'big');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startTicks).toBe(timelineTicks(6_000_000));
    expect(movedClip.timelineRange.durationTicks).toBe(timelineTicks(5_000_000));
  });

  it('trims end of clip that overlaps on the left', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'left',
            trackId: 'v1',
            name: 'Left',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(3_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(3_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'right',
            trackId: 'v1',
            name: 'Right',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(8_000_000), durationTicks: timelineTicks(2_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
          },
        ],
      },
    ]);

    // 'right' clip (2s) placed at 2_000_000 — overlaps 'left' on the left side
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'right',
      startTicks: timelineTicks(2_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const leftClip = resultClips.find((x) => x.id === 'left');
    expect(leftClip).toBeTruthy();
    // Should be trimmed to end at 2_000_000
    expect(leftClip.timelineRange.durationTicks).toBe(timelineTicks(2_000_000));

    const movedClip = resultClips.find((x) => x.id === 'right');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startTicks).toBe(timelineTicks(2_000_000));
  });

  it('trims start of clip that overlaps on the right', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'mover',
            trackId: 'v1',
            name: 'Mover',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'existing',
            trackId: 'v1',
            name: 'Existing',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(3_000_000), durationTicks: timelineTicks(3_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(3_000_000) },
          },
        ],
      },
    ]);

    // 'mover' (2s) placed at 4_000_000 — overlaps 'existing' on the right side
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'mover',
      startTicks: timelineTicks(4_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const existingClip = resultClips.find((x) => x.id === 'existing');
    expect(existingClip).toBeTruthy();
    // Existing starts at 3_000_000, mover covers 4_000_000–6_000_000
    // Existing should be trimmed to 3_000_000–4_000_000 (1s)
    expect(existingClip.timelineRange.startTicks).toBe(timelineTicks(3_000_000));
    expect(existingClip.timelineRange.durationTicks).toBe(timelineTicks(1_000_000));

    const movedClip = resultClips.find((x) => x.id === 'mover');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startTicks).toBe(timelineTicks(4_000_000));
  });

  it('splits a clip when placed fully inside it', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'long',
            trackId: 'v1',
            name: 'Long',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(10_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(10_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'short',
            trackId: 'v1',
            name: 'Short',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(20_000_000), durationTicks: timelineTicks(2_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
          },
        ],
      },
    ]);

    // Place 'short' (2s) at 3_000_000 — fully inside 'long' (0–10s)
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'short',
      startTicks: timelineTicks(3_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    // 'long' should be split into two pieces around 3_000_000–5_000_000
    const longPieces = resultClips.filter((x) => x.id !== 'short');
    expect(longPieces.length).toBe(2);

    const leftPiece = longPieces.find((x) => x.timelineRange.startTicks === 0);
    expect(leftPiece).toBeTruthy();
    expect(leftPiece.timelineRange.durationTicks).toBe(timelineTicks(3_000_000));

    const movedClip = resultClips.find((x) => x.id === 'short');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startTicks).toBe(timelineTicks(3_000_000));
  });

  it('preserves source ranges when splitting a reversed clip', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'long',
            trackId: 'v1',
            name: 'Long',
            source: { path: 'a.mp4' },
            sourceDurationTicks: timelineTicks(10_000_000),
            speed: -1,
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(6_000_000) },
            sourceRange: { startTicks: timelineTicks(2_000_000), durationTicks: timelineTicks(6_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'short',
            trackId: 'v1',
            name: 'Short',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(20_000_000), durationTicks: timelineTicks(2_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'short',
      startTicks: timelineTicks(2_000_000),
      quantizeToFrames: false,
    });

    const resultClips = clips(next.tracks[0]!);
    const longPieces = resultClips
      .filter((x) => x.id !== 'short')
      .sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);

    expect(longPieces).toHaveLength(2);
    expect(longPieces[0].timelineRange).toEqual({ startTicks: 0, durationTicks: timelineTicks(2_000_000) });
    expect(longPieces[0].sourceRange).toEqual({
      startTicks: timelineTicks(6_000_000),
      durationTicks: timelineTicks(2_000_000),
    });
    expect(longPieces[1].timelineRange).toEqual({
      startTicks: timelineTicks(4_000_000),
      durationTicks: timelineTicks(2_000_000),
    });
    expect(longPieces[1].sourceRange).toEqual({
      startTicks: timelineTicks(2_000_000),
      durationTicks: timelineTicks(2_000_000),
    });
  });

  it('no gaps between clips after overlay placement', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c1',
            trackId: 'v1',
            name: 'C1',
            backgroundColor: '#000',
            timelineRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c2',
            trackId: 'v1',
            name: 'C2',
            backgroundColor: '#fff',
            timelineRange: { startTicks: timelineTicks(8_000_000), durationTicks: timelineTicks(2_000_000) },
            sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
          },
        ],
      },
    ]);

    // Place c2 at 2_000_000 — overlaps c1 on the left side
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c2',
      startTicks: timelineTicks(2_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track).sort(
      (a: any, b: any) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );

    // Check no overlapping clips
    for (let i = 1; i < resultClips.length; i++) {
      const prev = resultClips[i - 1];
      const curr = resultClips[i];
      const prevEnd = prev.timelineRange.startTicks + prev.timelineRange.durationTicks;
      expect(curr.timelineRange.startTicks).toBeGreaterThanOrEqual(prevEnd);
    }
  });
});
