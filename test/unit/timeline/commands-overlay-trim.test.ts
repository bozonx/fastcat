/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineUs } from '../utils/timeline-time';
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

describe('timeline/commands overlay_trim_item', () => {
  it('trims and removes clips fully covered by the trimmed range', () => {
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
            timelineRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'victim',
            trackId: 'v1',
            name: 'Victim',
            backgroundColor: '#fff',
            timelineRange: { startUs: timelineUs(2_500_000), durationUs: timelineUs(200_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(200_000) },
          },
        ],
      },
    ]);

    // Extend mover end to 3_000_000 to fully cover victim.
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'mover',
      edge: 'end',
      deltaUs: timelineUs(1_000_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    expect(resultClips.find((x) => x.id === 'victim')).toBeUndefined();

    const moved = resultClips.find((x) => x.id === 'mover');
    expect(moved).toBeTruthy();
    expect(moved.timelineRange.durationUs).toBe(timelineUs(3_000_000));
  });

  it('trims overlapping clip on the left side of trimmed range', () => {
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
            timelineRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(2_000_000) },
          },
          {
            kind: 'clip',
            clipType: 'background',
            id: 'mover',
            trackId: 'v1',
            name: 'Mover',
            backgroundColor: '#0f0',
            timelineRange: { startUs: timelineUs(3_000_000), durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          },
        ],
      },
    ]);

    // Trim mover start right to 3_500_000 (deltaUs = +500_000)
    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'mover',
      edge: 'start',
      deltaUs: timelineUs(500_000),
    });

    const track = next.tracks[0]!;
    const resultClips = clips(track);

    const left = resultClips.find((x) => x.id === 'left');
    expect(left).toBeTruthy();
    // Left should remain unchanged (no overlap after trimming start to the right)
    expect(left.timelineRange.durationUs).toBe(timelineUs(2_000_000));

    const mover = resultClips.find((x) => x.id === 'mover');
    expect(mover).toBeTruthy();
    expect(mover.timelineRange.startUs).toBe(timelineUs(3_500_000));
  });

  it('trims the correct source edge for reversed clips', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'mover',
            trackId: 'v1',
            name: 'Mover',
            source: { path: 'a.mp4' },
            sourceDurationUs: timelineUs(10_000_000),
            speed: -1,
            timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(2_000_000) },
            sourceRange: { startUs: timelineUs(4_000_000), durationUs: timelineUs(2_000_000) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'overlay_trim_item',
      trackId: 'v1',
      itemId: 'mover',
      edge: 'start',
      deltaUs: timelineUs(1_000_000),
      quantizeToFrames: false,
    });

    const mover = clips(next.tracks[0]!).find((x) => x.id === 'mover');
    expect(mover.timelineRange).toEqual({ startUs: timelineUs(3_000_000), durationUs: timelineUs(1_000_000) });
    expect(mover.sourceRange).toEqual({ startUs: timelineUs(4_000_000), durationUs: timelineUs(1_000_000) });
  });
});
