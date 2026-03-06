import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument } from '~/timeline/types';

function makeDoc(): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        items: [],
      },
    ],
  };
}

describe('timeline/commands update_track_properties', () => {
  it('updates opacity and blendMode for a video track', () => {
    const next = applyTimelineCommand(makeDoc(), {
      type: 'update_track_properties',
      trackId: 'v1',
      properties: {
        opacity: 0.4,
        blendMode: 'multiply',
      },
    }).next;

    const track = next.tracks[0];
    expect(track?.opacity).toBe(0.4);
    expect(track?.blendMode).toBe('multiply');
  });
});
