/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { TICKS_PER_SECOND } from '~/utils/time';
import { addClipToTrack, addVirtualClipToTrack } from '~/timeline/commands/item/add';
import type { TimelineDocument } from '~/timeline/types';

function makeDoc(): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 't1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', items: [] }],
  };
}

describe('addClipToTrack', () => {
  it('quantizes startTicks and durationTicks to frame grid', () => {
    const doc = makeDoc();
    const result = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'clip',
      path: 'video/a.mp4',
      startTicks: 12_700_800_000,
      durationTicks: 12_700_800_000,
    });

    const items = result.next.tracks[0].items;
    const clip = items.find((it: any) => it.kind === 'clip');
    expect(clip).toBeDefined();
    // 50_000us at 30fps is between 1 and 2 frames; rounding gives two exact frames.
    expect(clip.timelineRange.startTicks).toBe((2 * TICKS_PER_SECOND) / 30);
    expect(clip.timelineRange.durationTicks).toBe((2 * TICKS_PER_SECOND) / 30);
  });

  it('keeps free startTicks and durationTicks when frame quantization is disabled', () => {
    const doc = makeDoc();
    const result = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'clip',
      path: 'video/a.mp4',
      startTicks: 12_700_800_000,
      durationTicks: 12_701_054_016,
      quantizeToFrames: false,
    });

    const clip = result.next.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip?.timelineRange).toEqual({
      startTicks: 12_700_800_000,
      durationTicks: 12_701_054_016,
    });
  });

  it('keeps virtual clip free startTicks and durationTicks when frame quantization is disabled', () => {
    const doc = makeDoc();
    const result = addVirtualClipToTrack(doc, {
      type: 'add_virtual_clip_to_track',
      trackId: 'v1',
      clipType: 'text',
      name: 'text',
      startTicks: 12_700_800_000,
      durationTicks: 12_701_054_016,
      quantizeToFrames: false,
    });

    const clip = result.next.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip?.timelineRange).toEqual({
      startTicks: 12_700_800_000,
      durationTicks: 12_701_054_016,
    });
  });

  it('throws when adding an overlapping clip without pseudo', () => {
    const doc = makeDoc();
    const withClip = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'first',
      path: 'video/a.mp4',
      startTicks: 0,
      durationTicks: 254_016_000_000,
    });

    expect(() =>
      addClipToTrack(withClip.next, {
        type: 'add_clip_to_track',
        trackId: 'v1',
        name: 'second',
        path: 'video/b.mp4',
        startTicks: 127_008_000_000,
        durationTicks: 254_016_000_000,
      }),
    ).toThrow('Item overlaps with another item');
  });

  it('allows back-to-back clips (no overlap)', () => {
    const doc = makeDoc();
    const first = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'first',
      path: 'video/a.mp4',
      startTicks: 0,
      durationTicks: 254_016_000_000,
    });

    expect(() =>
      addClipToTrack(first.next, {
        type: 'add_clip_to_track',
        trackId: 'v1',
        name: 'second',
        path: 'video/b.mp4',
        startTicks: 254_016_000_000,
        durationTicks: 254_016_000_000,
      }),
    ).not.toThrow();
  });

  it('cuts the existing clip instead of trimming a new pseudo clip', () => {
    const first = addClipToTrack(makeDoc(), {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'existing',
      path: 'video/existing.mp4',
      startTicks: 508_032_000_000,
      durationTicks: 1_016_064_000_000,
      quantizeToFrames: false,
    });

    const result = addClipToTrack(first.next, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'dropped',
      path: 'image/dropped.png',
      startTicks: 0,
      durationTicks: 1_016_064_000_000,
      sourceDurationTicks: 1_016_064_000_000,
      isImage: true,
      pseudo: true,
      quantizeToFrames: false,
    });

    const clips = result.next.tracks[0].items.filter((it: any) => it.kind === 'clip');
    const existing = clips.find((it: any) => it.name === 'existing');
    const dropped = clips.find((it: any) => it.name === 'dropped');

    expect(existing?.timelineRange).toEqual({
      startTicks: 1_016_064_000_000,
      durationTicks: 508_032_000_000,
    });
    expect(dropped?.timelineRange).toEqual({
      startTicks: 0,
      durationTicks: 1_016_064_000_000,
    });
    expect(dropped?.sourceRange).toEqual({
      startTicks: 0,
      durationTicks: 1_016_064_000_000,
    });
  });

  it('allows a new pseudo clip to start inside an existing clip and cuts the existing clip', () => {
    const first = addClipToTrack(makeDoc(), {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'existing',
      path: 'video/existing.mp4',
      startTicks: 0,
      durationTicks: 508_032_000_000,
      quantizeToFrames: false,
    });

    const result = addClipToTrack(first.next, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'dropped',
      path: 'video/dropped.mp4',
      startTicks: 254_016_000_000,
      durationTicks: 1_016_064_000_000,
      sourceDurationTicks: 1_016_064_000_000,
      pseudo: true,
      quantizeToFrames: false,
    });

    const clips = result.next.tracks[0].items.filter((it: any) => it.kind === 'clip');
    const existing = clips.find((it: any) => it.name === 'existing');
    const dropped = clips.find((it: any) => it.name === 'dropped');

    expect(existing?.timelineRange).toEqual({
      startTicks: 0,
      durationTicks: 254_016_000_000,
    });
    expect(dropped?.timelineRange).toEqual({
      startTicks: 254_016_000_000,
      durationTicks: 1_016_064_000_000,
    });
    expect(dropped?.sourceRange).toEqual({
      startTicks: 0,
      durationTicks: 1_016_064_000_000,
    });
  });
});
