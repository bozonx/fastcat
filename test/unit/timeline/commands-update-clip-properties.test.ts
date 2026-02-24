import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

function makeDoc(track: TimelineTrack): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [track],
  };
}

describe('timeline/commands update_clip_properties', () => {
  it('updates opacity for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { opacity: 0.25 },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.opacity).toBe(0.25);
  });

  it('updates effects list for a clip', () => {
    const doc = makeDoc({
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          id: 'c1',
          trackId: 'v1',
          name: 'C1',
          source: { path: 'a.mp4' },
          sourceDurationUs: 10_000_000,
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    const effects = [
      {
        id: 'e1',
        type: 'color-adjustment',
        enabled: true,
        brightness: 1,
        contrast: 1,
        saturation: 1,
      },
    ];

    const next = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: 'c1',
      properties: { effects },
    }).next;

    const clip = (next.tracks[0] as TimelineTrack).items[0] as any;
    expect(clip.effects).toEqual(effects);
  });
});
