/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { timelineUs } from '../utils/timeline-time';
import {
  buildSplitAllClipsCommands,
  buildSplitSelectedClipsCommands,
} from '~/timeline/domain/editing';
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

function makeClip(id: string, startUs: number, durationUs: number): TimelineTrackItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 'v1',
    name: id,
    source: { path: `${id}.mp4` },
    sourceDurationUs: durationUs,
    timelineRange: { startUs, durationUs },
    sourceRange: { startUs: 0, durationUs },
  };
}

describe('timeline/domain editing', () => {
  it('builds split-all commands only for clips containing the cut', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          makeClip('before', 0, timelineUs(1_000_000)),
          makeClip('target', timelineUs(2_000_000), timelineUs(1_000_000)),
          makeClip('after', timelineUs(4_000_000), timelineUs(1_000_000)),
        ],
      },
    ]);

    expect(buildSplitAllClipsCommands(doc, timelineUs(2_500_000))).toEqual([
      { type: 'split_item', trackId: 'v1', itemId: 'target', atUs: timelineUs(2_500_000) },
    ]);
  });

  it('skips selected clips that do not contain the cut', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('selected-outside', 0, timelineUs(1_000_000))],
      },
    ]);

    expect(buildSplitSelectedClipsCommands(doc, timelineUs(2_500_000), ['selected-outside'])).toEqual([]);
  });
});
