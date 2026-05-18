/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
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

function makeClip(id: string, startUs: number, locked = false): TimelineTrackItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 'v1',
    name: id,
    source: { path: `${id}.mp4` },
    sourceDurationUs: 1_000_000,
    timelineRange: { startUs, durationUs: 1_000_000 },
    sourceRange: { startUs: 0, durationUs: 1_000_000 },
    locked,
  };
}

describe('timeline/commands move_items', () => {
  it('moves many same-track clips as one final layout', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('c2', 1_000_000), makeClip('c3', 2_000_000)],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'move_items',
      moves: [
        { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c2', startUs: 0 },
        { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c3', startUs: 1_000_000 },
      ],
      quantizeToFrames: false,
      ignoreLinks: true,
    });

    const clips = next.tracks[0]?.items.filter((item) => item.kind === 'clip') ?? [];

    expect(clips.map((item) => [item.id, item.timelineRange.startUs])).toEqual([
      ['c2', 0],
      ['c3', 1_000_000],
    ]);
  });

  it('throws when a same-track batch moves a locked clip without ignoreLocks', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('c1', 0, true), makeClip('c2', 1_000_000)],
      },
    ]);

    expect(() =>
      applyTimelineCommand(doc, {
        type: 'move_items',
        moves: [{ fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c1', startUs: 2_000_000 }],
        quantizeToFrames: false,
        ignoreLinks: true,
      }),
    ).toThrow('Locked clip: move');
  });
});
