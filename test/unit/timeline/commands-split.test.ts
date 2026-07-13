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

describe('timeline/commands split_item', () => {
  it('does not create overlap or gaps due to frame quantization', () => {
    const doc = makeDoc([
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [
          {
            kind: 'clip',
            clipType: 'background',
            id: 'img1',
            trackId: 'v1',
            name: 'Image',
            backgroundColor: '#000000',
            timelineRange: { startUs: 0, durationUs: timelineUs(999_999) },
            sourceRange: { startUs: 0, durationUs: timelineUs(999_999) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'img1',
      atUs: timelineUs(333_333),
    });

    const items = next.tracks[0]?.items ?? [];
    const clips = items.filter((x: TimelineTrackItem) => x.kind === 'clip') as any[];
    expect(clips.length).toBe(2);

    const ordered = [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const left = ordered[0];
    const right = ordered[1];

    expect(right.timelineRange.startUs).toBe(
      left.timelineRange.startUs + left.timelineRange.durationUs,
    );

    const gaps = items.filter((x: TimelineTrackItem) => x.kind === 'gap');
    expect(gaps.length).toBe(0);
  });

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
            sourceDurationUs: timelineUs(10_000_000),
            timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'c1',
      atUs: timelineUs(500_000),
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
    expect(left.sourceRange.durationUs + right.sourceRange.durationUs).toBe(timelineUs(1_000_000));
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
            sourceDurationUs: timelineUs(10_000_000),
            timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
      atUs: timelineUs(1_000_000),
    }).next;

    expect(atStart.tracks[0]?.items.filter((x) => x.kind === 'clip').length).toBe(1);
    expect(atEnd.tracks[0]?.items.filter((x) => x.kind === 'clip').length).toBe(1);
  });

  it('splits grouped clip and assigns two new linkedGroupIds to both halves, and reassigns uncut group clip', () => {
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
            sourceDurationUs: timelineUs(10_000_000),
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
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
            sourceDurationUs: timelineUs(10_000_000),
            linkedGroupId: 'group-1',
            timelineRange: { startUs: 0, durationUs: timelineUs(500_000) },
            sourceRange: { startUs: 0, durationUs: timelineUs(500_000) },
          },
        ],
      },
    ]);

    const { next } = applyTimelineCommand(doc, {
      type: 'split_item',
      trackId: 'v1',
      itemId: 'vclip',
      atUs: timelineUs(500_000),
    });

    const videoClips = next.tracks[0]?.items.filter((x) => x.kind === 'clip') as any[];
    expect(videoClips.length).toBe(2);

    const leftVideo = videoClips.find((x) => x.id === 'vclip');
    const rightVideo = videoClips.find((x) => x.id !== 'vclip');

    expect(leftVideo.linkedGroupId).toBeDefined();
    expect(rightVideo.linkedGroupId).toBeDefined();
    expect(leftVideo.linkedGroupId).not.toBe(rightVideo.linkedGroupId);
    expect(leftVideo.linkedGroupId).not.toBe('group-1');

    // The audio clip on a1 was not split because atUs (500_000) is at its boundary/outside,
    // but it should be reassigned to the left group because its startUs < atUs.
    const audioClip = next.tracks[1]?.items.find((x) => x.id === 'aclip') as any;
    expect(audioClip.linkedGroupId).toBe(leftVideo.linkedGroupId);
  });
});
