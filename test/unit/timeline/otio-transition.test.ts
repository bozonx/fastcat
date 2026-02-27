import { describe, it, expect } from 'vitest';
import {
  serializeTimelineToOtio,
  parseTimelineFromOtio,
} from '../../../src/timeline/otioSerializer';
import type { TimelineDocument } from '../../../src/timeline/types';

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
        items: [
          {
            kind: 'clip',
            id: 'c1',
            trackId: 'v1',
            name: 'Clip1',
            clipType: 'media',
            disabled: true,
            locked: true,
            source: { path: 'file.mp4' },
            sourceDurationUs: 10_000_000,
            timelineRange: { startUs: 0, durationUs: 5_000_000 },
            sourceRange: { startUs: 0, durationUs: 5_000_000 },
            transitionIn: { type: 'dissolve', durationUs: 300_000 },
            transitionOut: { type: 'dissolve', durationUs: 500_000 },
            audioGain: 1.25,
            audioFadeInUs: 200_000,
            audioFadeOutUs: 400_000,
          },
        ],
      },
    ],
    metadata: {
      gran: {
        docId: 'doc1',
        timebase: { fps: 30 },
        markers: [
          { id: 'm1', timeUs: 1_000_000, text: 'Hello world' },
          { id: 'm2', timeUs: 500_000, text: 'Second' },
        ],
      },
    },
  };
}

describe('timeline/otioSerializer: transitions', () => {
  it('serializes and deserializes transitionIn and transitionOut', () => {
    const doc = makeDoc();
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.disabled).toBe(true);
    expect(clip.locked).toBe(true);
    expect(clip.transitionIn).toEqual({ type: 'dissolve', durationUs: 300_000 });
    expect(clip.transitionOut).toEqual({ type: 'dissolve', durationUs: 500_000 });
    expect(clip.audioGain).toBe(1.25);
    expect(clip.audioFadeInUs).toBe(200_000);
    expect(clip.audioFadeOutUs).toBe(400_000);

    expect((parsed.metadata as any)?.gran?.markers).toEqual([
      { id: 'm2', timeUs: 500_000, text: 'Second' },
      { id: 'm1', timeUs: 1_000_000, text: 'Hello world' },
    ]);
  });

  it('omits transitions when not set', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip1',
              clipType: 'media',
              source: { path: 'file.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 5_000_000 },
              sourceRange: { startUs: 0, durationUs: 5_000_000 },
            },
          ],
        },
      ],
    };
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.transitionIn).toBeUndefined();
    expect(clip.transitionOut).toBeUndefined();
  });
});
