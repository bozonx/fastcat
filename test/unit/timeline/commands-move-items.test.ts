/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
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

function makeClip(id: string, startTicks: number, locked = false): TimelineTrackItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 'v1',
    name: id,
    source: { path: `${id}.mp4` },
    sourceDurationTicks: timelineTicks(1_000_000),
    timelineRange: { startTicks, durationTicks: timelineTicks(1_000_000) },
    sourceRange: { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
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
        items: [makeClip('c2', timelineTicks(1_000_000)), makeClip('c3', timelineTicks(2_000_000))],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'move_items',
      moves: [
        { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c2', startTicks: 0 },
        { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c3', startTicks: timelineTicks(1_000_000) },
      ],
      quantizeToFrames: false,
      ignoreLinks: true,
    });

    const clips = next.tracks[0]?.items.filter((item) => item.kind === 'clip') ?? [];

    expect(clips.map((item) => [item.id, item.timelineRange.startTicks])).toEqual([
      ['c2', 0],
      ['c3', timelineTicks(1_000_000)],
    ]);
  });

  it('snaps an off-grid start to the frame grid when quantizeToFrames is on', () => {
    const doc = makeDoc([{ id: 'v1', kind: 'video', name: 'V1', items: [makeClip('c1', 0)] }]);

    // 1_015_000µs @30fps sits between frame 30 (1_000_000) and 31 (1_033_333);
    // absolute quantization rounds it back onto frame 30.
    const { next } = applyTimelineCommand(doc, {
      type: 'move_items',
      moves: [{ fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c1', startTicks: timelineTicks(1_015_000) }],
      quantizeToFrames: true,
      ignoreLinks: true,
    });

    const c1 = next.tracks[0]?.items.find((it) => it.id === 'c1');
    expect(c1?.timelineRange.startTicks).toBe(timelineTicks(1_000_000));
  });

  it('preserveItemOffsets keeps off-grid starts verbatim despite quantizeToFrames', () => {
    const doc = makeDoc([{ id: 'v1', kind: 'video', name: 'V1', items: [makeClip('c1', 0)] }]);

    const { next } = applyTimelineCommand(doc, {
      type: 'move_items',
      moves: [{ fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c1', startTicks: timelineTicks(1_015_000) }],
      quantizeToFrames: true,
      ignoreLinks: true,
      preserveItemOffsets: true,
    });

    const c1 = next.tracks[0]?.items.find((it) => it.id === 'c1');
    expect(c1?.timelineRange.startTicks).toBe(timelineTicks(1_015_000));
  });

  it('preserveItemOffsets moves a mixed on-grid/off-grid group rigidly, keeping each phase', () => {
    // c1 on the frame grid, c2 placed off-grid (15_000µs sub-frame offset).
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('c1', 0), makeClip('c2', timelineTicks(2_015_000))],
      },
    ]);

    // A rigid +2-frame group shift (66_667µs at 30fps), already baked into starts.
    const deltaTicks = timelineTicks(66_667);
    const { next } = applyTimelineCommand(doc, {
      type: 'move_items',
      moves: [
        { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c1', startTicks: 0 + deltaTicks },
        {
          fromTrackId: 'v1',
          toTrackId: 'v1',
          itemId: 'c2',
          startTicks: timelineTicks(2_015_000) + deltaTicks,
        },
      ],
      quantizeToFrames: true,
      ignoreLinks: true,
      preserveItemOffsets: true,
    });

    const clips = (next.tracks[0]?.items ?? []).filter((it) => it.kind === 'clip');
    const byId = Object.fromEntries(clips.map((it) => [it.id, it.timelineRange.startTicks]));

    // On-grid member lands exactly on frame 2; off-grid member keeps its 15_000µs
    // sub-frame phase instead of being pulled onto the grid.
    expect(byId.c1).toBe(timelineTicks(66_667));
    expect(byId.c2).toBe(timelineTicks(2_081_667));
  });

  it('throws when a same-track batch moves a locked clip without ignoreLocks', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('c1', 0, true), makeClip('c2', timelineTicks(1_000_000))],
      },
    ]);

    expect(() =>
      applyTimelineCommand(doc, {
        type: 'move_items',
        moves: [
          { fromTrackId: 'v1', toTrackId: 'v1', itemId: 'c1', startTicks: timelineTicks(2_000_000) },
        ],
        quantizeToFrames: false,
        ignoreLinks: true,
      }),
    ).toThrow('Locked clip: move');
  });
});
