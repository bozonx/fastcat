/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { addClipToTrack } from '~/timeline/commands/item/add';
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
  it('quantizes startUs and durationUs to frame grid', () => {
    const doc = makeDoc();
    const result = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'clip',
      path: 'video/a.mp4',
      startUs: 50_000,
      durationUs: 50_000,
    });

    const items = result.next.tracks[0].items;
    const clip = items.find((it: any) => it.kind === 'clip');
    expect(clip).toBeDefined();
    // 50_000us at 30fps is between 1 and 2 frames; rounding gives 2 frames = 66_667us
    expect(clip.timelineRange.startUs).toBe(66_667);
    expect(clip.timelineRange.durationUs).toBe(66_667);
  });

  it('throws when adding an overlapping clip without pseudo', () => {
    const doc = makeDoc();
    const withClip = addClipToTrack(doc, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'first',
      path: 'video/a.mp4',
      startUs: 0,
      durationUs: 1_000_000,
    });

    expect(() =>
      addClipToTrack(withClip.next, {
        type: 'add_clip_to_track',
        trackId: 'v1',
        name: 'second',
        path: 'video/b.mp4',
        startUs: 500_000,
        durationUs: 1_000_000,
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
      startUs: 0,
      durationUs: 1_000_000,
    });

    expect(() =>
      addClipToTrack(first.next, {
        type: 'add_clip_to_track',
        trackId: 'v1',
        name: 'second',
        path: 'video/b.mp4',
        startUs: 1_000_000,
        durationUs: 1_000_000,
      }),
    ).not.toThrow();
  });
});
