import { describe, expect, it } from 'vitest';

import {
  computeMediaUsageByTimelineDocs,
  getTimelinesUsingMediaPath,
} from '../../../src/utils/timeline-media-usage';

describe('timeline-media-usage', () => {
  it('collects unique media paths per timeline and returns sorted timeline refs', () => {
    const t1 = {
      timelinePath: 'timelines/A.otio',
      timelineName: 'A',
      timelineDoc: {
        OTIO_SCHEMA: 'Timeline.1',
        id: 't1',
        name: 'A',
        timebase: { fps: 25 },
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            name: 'V1',
            items: [
              {
                kind: 'clip',
                clipType: 'media',
                id: 'c1',
                trackId: 'v1',
                name: 'clip1',
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
                source: { path: 'video/x.mp4' },
                sourceDurationUs: 1_000_000,
              },
              {
                kind: 'clip',
                clipType: 'media',
                id: 'c2',
                trackId: 'v1',
                name: 'clip2',
                timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
                source: { path: 'video/x.mp4' },
                sourceDurationUs: 1_000_000,
              },
              {
                kind: 'clip',
                clipType: 'text',
                id: 'txt1',
                trackId: 'v1',
                name: 'text',
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
                text: 'hello',
              },
            ],
          },
        ],
      },
    };

    const t2 = {
      timelinePath: 'timelines/B.otio',
      timelineName: 'B',
      timelineDoc: {
        OTIO_SCHEMA: 'Timeline.1',
        id: 't2',
        name: 'B',
        timebase: { fps: 25 },
        tracks: [
          {
            id: 'a1',
            kind: 'audio',
            name: 'A1',
            items: [
              {
                kind: 'clip',
                clipType: 'media',
                id: 'a1c1',
                trackId: 'a1',
                name: 'clip1',
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
                source: { path: 'audio/y.mp3' },
                sourceDurationUs: 1_000_000,
              },
              {
                kind: 'gap',
                id: 'g1',
                trackId: 'a1',
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
              },
            ],
          },
        ],
      },
    };

    const t3 = {
      timelinePath: 'timelines/C.otio',
      timelineName: 'C',
      timelineDoc: {
        OTIO_SCHEMA: 'Timeline.1',
        id: 't3',
        name: 'C',
        timebase: { fps: 25 },
        tracks: [
          {
            id: 'v1',
            kind: 'video',
            name: 'V1',
            items: [
              {
                kind: 'clip',
                clipType: 'media',
                id: 'c1',
                trackId: 'v1',
                name: 'clip1',
                timelineRange: { startUs: 0, durationUs: 1_000_000 },
                sourceRange: { startUs: 0, durationUs: 1_000_000 },
                source: { path: 'video/x.mp4' },
                sourceDurationUs: 1_000_000,
              },
            ],
          },
        ],
      },
    };

    const { mediaPathToTimelines } = computeMediaUsageByTimelineDocs([
      t2 as any,
      t1 as any,
      t3 as any,
    ]);

    expect(Object.keys(mediaPathToTimelines).sort()).toEqual(['audio/y.mp3', 'video/x.mp4']);

    expect(mediaPathToTimelines['audio/y.mp3']).toEqual([
      { timelinePath: 'timelines/B.otio', timelineName: 'B' },
    ]);

    expect(mediaPathToTimelines['video/x.mp4']).toEqual([
      { timelinePath: 'timelines/A.otio', timelineName: 'A' },
      { timelinePath: 'timelines/C.otio', timelineName: 'C' },
    ]);

    expect(getTimelinesUsingMediaPath(mediaPathToTimelines, 'video/x.mp4')).toHaveLength(2);
    expect(getTimelinesUsingMediaPath(mediaPathToTimelines, 'missing.mp4')).toEqual([]);
  });
});
