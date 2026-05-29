/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

function makeDoc(tracks: TimelineTrack[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks,
  };
}

describe('timeline/commands group operations', () => {
  it('deletes all clips in a linked group across tracks', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'vclip',
            trackId: 'v1',
            name: 'Video',
            source: { path: 'v.mp4' },
            sourceDurationUs: 10_000_000,
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
      {
        id: 'a1',
        kind: 'audio',
        name: 'A1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'aclip',
            trackId: 'a1',
            name: 'Audio',
            source: { path: 'a.mp4' },
            sourceDurationUs: 10_000_000,
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'delete_items',
      trackId: 'v1',
      itemIds: ['vclip'],
    });

    const videoClips = next.tracks[0]?.items.filter((x) => x.kind === 'clip');
    const audioClips = next.tracks[1]?.items.filter((x) => x.kind === 'clip');

    expect(videoClips.length).toBe(0);
    expect(audioClips.length).toBe(0);
  });

  it('trims all clips in a linked group synchronously', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'vclip',
            trackId: 'v1',
            name: 'Video',
            source: { path: 'v.mp4' },
            sourceDurationUs: 10_000_000,
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
      {
        id: 'a1',
        kind: 'audio',
        name: 'A1',
        items: [
          {
            kind: 'clip',
            clipType: 'media',
            id: 'aclip',
            trackId: 'a1',
            name: 'Audio',
            source: { path: 'a.mp4' },
            sourceDurationUs: 10_000_000,
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'trim_item',
      trackId: 'v1',
      itemId: 'vclip',
      edge: 'end',
      deltaUs: -100_000,
    });

    const vclip = next.tracks[0]?.items.find((x) => x.id === 'vclip') as any;
    const aclip = next.tracks[1]?.items.find((x) => x.id === 'aclip') as any;

    expect(vclip.timelineRange.durationUs).toBe(900_000);
    expect(aclip.timelineRange.durationUs).toBe(900_000);
  });
});
