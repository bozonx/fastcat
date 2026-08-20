/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
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

function makeClip(id: string, startTicks: number, durationTicks: number): TimelineTrackItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 'v1',
    name: id,
    source: { path: `${id}.mp4` },
    sourceDurationTicks: durationTicks,
    timelineRange: { startTicks, durationTicks },
    sourceRange: { startTicks: 0, durationTicks },
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
          makeClip('before', 0, 254_016_000_000),
          makeClip('target', 508_032_000_000, 254_016_000_000),
          makeClip('after', 1_016_064_000_000, 254_016_000_000),
        ],
      },
    ]);

    expect(buildSplitAllClipsCommands(doc, 635_040_000_000)).toEqual([
      { type: 'split_item', trackId: 'v1', itemId: 'target', atTicks: 635_040_000_000 },
    ]);
  });

  it('skips selected clips that do not contain the cut', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [makeClip('selected-outside', 0, 254_016_000_000)],
      },
    ]);

    expect(buildSplitSelectedClipsCommands(doc, 635_040_000_000, ['selected-outside'])).toEqual([]);
  });
});
