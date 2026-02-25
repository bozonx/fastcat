import { describe, it, expect } from 'vitest';
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
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c2',
            trackId: 'v1',
            name: 'C2',
            backgroundColor: '#fff',
            timelineRange: { startUs: 3_000_000, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_place_item',
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startUs: 5_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);
    expect(resultClips.length).toBe(2);

    const movedClip = resultClips.find((x) => x.id === 'c1');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startUs).toBe(5_000_000);

    const otherClip = resultClips.find((x) => x.id === 'c2');
    expect(otherClip).toBeTruthy();
    expect(otherClip.timelineRange.startUs).toBe(3_000_000);
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
            timelineRange: { startUs: 0, durationUs: 5_000_000 },
            sourceRange: { startUs: 0, durationUs: 5_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'small',
            trackId: 'v1',
            name: 'Small',
            backgroundColor: '#fff',
            timelineRange: { startUs: 7_000_000, durationUs: 500_000 },
            sourceRange: { startUs: 0, durationUs: 500_000 },
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
      startUs: 6_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const smallClip = resultClips.find((x) => x.id === 'small');
    expect(smallClip).toBeUndefined();

    const movedClip = resultClips.find((x) => x.id === 'big');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startUs).toBe(6_000_000);
    expect(movedClip.timelineRange.durationUs).toBe(5_000_000);
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
            timelineRange: { startUs: 0, durationUs: 3_000_000 },
            sourceRange: { startUs: 0, durationUs: 3_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'right',
            trackId: 'v1',
            name: 'Right',
            backgroundColor: '#fff',
            timelineRange: { startUs: 8_000_000, durationUs: 2_000_000 },
            sourceRange: { startUs: 0, durationUs: 2_000_000 },
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
      startUs: 2_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const leftClip = resultClips.find((x) => x.id === 'left');
    expect(leftClip).toBeTruthy();
    // Should be trimmed to end at 2_000_000
    expect(leftClip.timelineRange.durationUs).toBe(2_000_000);

    const movedClip = resultClips.find((x) => x.id === 'right');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startUs).toBe(2_000_000);
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
            timelineRange: { startUs: 0, durationUs: 2_000_000 },
            sourceRange: { startUs: 0, durationUs: 2_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'existing',
            trackId: 'v1',
            name: 'Existing',
            backgroundColor: '#fff',
            timelineRange: { startUs: 3_000_000, durationUs: 3_000_000 },
            sourceRange: { startUs: 0, durationUs: 3_000_000 },
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
      startUs: 4_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const existingClip = resultClips.find((x) => x.id === 'existing');
    expect(existingClip).toBeTruthy();
    // Existing starts at 3_000_000, mover covers 4_000_000–6_000_000
    // Existing should be trimmed to 3_000_000–4_000_000 (1s)
    expect(existingClip.timelineRange.startUs).toBe(3_000_000);
    expect(existingClip.timelineRange.durationUs).toBe(1_000_000);

    const movedClip = resultClips.find((x) => x.id === 'mover');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startUs).toBe(4_000_000);
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
            timelineRange: { startUs: 0, durationUs: 10_000_000 },
            sourceRange: { startUs: 0, durationUs: 10_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'short',
            trackId: 'v1',
            name: 'Short',
            backgroundColor: '#fff',
            timelineRange: { startUs: 20_000_000, durationUs: 2_000_000 },
            sourceRange: { startUs: 0, durationUs: 2_000_000 },
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
      startUs: 3_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    // 'long' should be split into two pieces around 3_000_000–5_000_000
    const longPieces = resultClips.filter((x) => x.id !== 'short');
    expect(longPieces.length).toBe(2);

    const leftPiece = longPieces.find((x) => x.timelineRange.startUs === 0);
    expect(leftPiece).toBeTruthy();
    expect(leftPiece.timelineRange.durationUs).toBe(3_000_000);

    const movedClip = resultClips.find((x) => x.id === 'short');
    expect(movedClip).toBeTruthy();
    expect(movedClip.timelineRange.startUs).toBe(3_000_000);
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
            timelineRange: { startUs: 0, durationUs: 4_000_000 },
            sourceRange: { startUs: 0, durationUs: 4_000_000 },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'c2',
            trackId: 'v1',
            name: 'C2',
            backgroundColor: '#fff',
            timelineRange: { startUs: 8_000_000, durationUs: 2_000_000 },
            sourceRange: { startUs: 0, durationUs: 2_000_000 },
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
      startUs: 2_000_000,
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track).sort(
      (a: any, b: any) => a.timelineRange.startUs - b.timelineRange.startUs,
    );

    // Check no overlapping clips
    for (let i = 1; i < resultClips.length; i++) {
      const prev = resultClips[i - 1];
      const curr = resultClips[i];
      const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
      expect(curr.timelineRange.startUs).toBeGreaterThanOrEqual(prevEnd);
    }
  });
});
