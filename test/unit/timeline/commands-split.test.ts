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

describe('timeline/commands split_item', () => {
  it('splits a clip into two at playhead time', () => {
    const doc = makeDoc([
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
            name: 'C1',
            source: { path: 'a.mp4' },
            sourceDurationUs: 10_000_000,
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'c1',
      atUs: 500_000,
    });

    const items = next.tracks[0]?.items ?? [];
    const clips = items.filter((x: TimelineTrackItem) => x.kind === 'clip') as any[];
    expect(clips.length).toBe(2);

    const left = clips.find((x) => x.id === 'c1');
    const right = clips.find((x) => x.id !== 'c1');

    expect(left.timelineRange.startUs).toBe(0);
    expect(left.timelineRange.durationUs).toBeGreaterThan(0);

    expect(right.timelineRange.startUs).toBe(left.timelineRange.durationUs);
    expect(right.timelineRange.durationUs).toBeGreaterThan(0);

    expect(left.sourceRange.startUs).toBe(0);
    expect(left.sourceRange.durationUs + right.sourceRange.durationUs).toBe(1_000_000);
    expect(right.sourceRange.startUs).toBe(left.sourceRange.durationUs);
  });

  it('does nothing when splitting at the clip boundary', () => {
    const doc = makeDoc([
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
            name: 'C1',
            source: { path: 'a.mp4' },
            sourceDurationUs: 10_000_000,
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const atStart = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'c1',
      atUs: 0,
    }).next;

    const atEnd = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'c1',
      atUs: 1_000_000,
    }).next;

    expect(atStart.tracks[0]?.items.filter((x) => x.kind === 'clip').length).toBe(1);
    expect(atEnd.tracks[0]?.items.filter((x) => x.kind === 'clip').length).toBe(1);
  });

  it('splits locked linked audio when splitting the linked video clip', () => {
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
            source: { path: 'a.mp4' },
            sourceDurationUs: 10_000_000,
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
            linkedVideoClipId: 'vclip',
            lockToLinkedVideo: true,
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'vclip',
      atUs: 500_000,
    });

    const videoClips = next.tracks[0]?.items.filter((x) => x.kind === 'clip') as any[];
    expect(videoClips.length).toBe(2);

    const rightVideo = videoClips.find((x) => x.id !== 'vclip');
    expect(rightVideo).toBeTruthy();

    const audioClips = next.tracks[1]?.items.filter((x) => x.kind === 'clip') as any[];
    expect(audioClips.length).toBe(2);

    const leftAudio = audioClips.find((x) => x.linkedVideoClipId === 'vclip');
    const rightAudio = audioClips.find((x) => x.linkedVideoClipId === rightVideo.id);

    expect(leftAudio).toBeTruthy();
    expect(rightAudio).toBeTruthy();
  });
});
