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
        opacity: 0.6,
        blendMode: 'screen',
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
            opacity: 0.5,
            blendMode: 'multiply',
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
    const track = parsed.tracks[0] as any;
    expect(track.opacity).toBe(0.6);
    expect(track.blendMode).toBe('screen');
    expect(clip.disabled).toBe(true);
    expect(clip.locked).toBe(true);
    expect(clip.opacity).toBe(0.5);
    expect(clip.blendMode).toBe('multiply');
    expect(clip.transitionIn).toEqual({
      type: 'dissolve',
      durationUs: 300_000,
      mode: 'transition',
      curve: 'linear',
      params: undefined,
    });
    expect(clip.transitionOut).toEqual({
      type: 'dissolve',
      durationUs: 500_000,
      mode: 'transition',
      curve: 'linear',
      params: undefined,
    });
    expect(clip.audioGain).toBe(1.25);
    expect(clip.audioFadeInUs).toBe(200_000);
    expect(clip.audioFadeOutUs).toBe(400_000);

    expect((parsed.metadata as any)?.gran?.markers).toEqual([
      { id: 'm2', timeUs: 500_000, text: 'Second' },
      { id: 'm1', timeUs: 1_000_000, text: 'Hello world' },
    ]);
  });

  it('preserves transition params, mode and curve through OTIO round-trip', () => {
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
              transitionIn: {
                type: 'clock',
                durationUs: 300_000,
                mode: 'fade',
                curve: 'bezier',
                params: { direction: 'counterclockwise' },
              },
              transitionOut: {
                type: 'wipe',
                durationUs: 500_000,
                mode: 'transition',
                curve: 'linear',
                params: {
                  direction: 'right',
                  gap: 0.04,
                  gapColor: '#00ff00',
                },
              },
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.transitionIn).toEqual({
      type: 'clock',
      durationUs: 300_000,
      mode: 'fade',
      curve: 'bezier',
      params: { direction: 'counterclockwise' },
    });
    expect(clip.transitionOut).toEqual({
      type: 'wipe',
      durationUs: 500_000,
      mode: 'transition',
      curve: 'linear',
      params: {
        direction: 'right',
        gap: 0.04,
        gapColor: '#00ff00',
      },
    });
  });

  it('normalizes legacy OTIO transition modes on parse', () => {
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
              transitionIn: { type: 'clock', durationUs: 300_000, mode: 'fade' },
              transitionOut: { type: 'wipe', durationUs: 500_000, mode: 'transition' },
            },
          ],
        },
      ],
    };

    const serialized = JSON.parse(serializeTimelineToOtio(doc)) as any;
    const gran = serialized.tracks.children[0].children[0].metadata.gran;
    gran.transitionIn.mode = 'composite';
    gran.transitionOut.mode = 'blend_previous';

    const parsed = parseTimelineFromOtio(JSON.stringify(serialized), {
      id: 'doc1',
      name: 'Test',
      fps: 30,
    });
    const clip = parsed.tracks[0]?.items[0] as any;

    expect(clip.transitionIn.mode).toBe('fade');
    expect(clip.transitionOut.mode).toBe('transition');
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

  it('preserves nested timeline clips through OTIO round-trip', () => {
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
              id: 'nested1',
              trackId: 'v1',
              name: 'Nested sequence',
              clipType: 'timeline',
              source: { path: '_timelines/sequence.otio' },
              sourceDurationUs: 12_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
              sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
              audioGain: 0.75,
              audioFadeInUs: 150_000,
              audioFadeOutUs: 250_000,
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('timeline');
    expect(clip.source?.path).toBe('_timelines/sequence.otio');
    expect(clip.sourceDurationUs).toBe(12_000_000);
    expect(clip.sourceRange).toEqual({ startUs: 2_000_000, durationUs: 5_000_000 });
    expect(clip.audioGain).toBe(0.75);
    expect(clip.audioFadeInUs).toBe(150_000);
    expect(clip.audioFadeOutUs).toBe(250_000);
  });

  it('infers nested timeline clip from .otio target_url without gran clipType', () => {
    const parsed = parseTimelineFromOtio(
      JSON.stringify({
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Imported nested',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'Nested external timeline',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: '_timelines/external-sequence.otio',
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: {
                      OTIO_SCHEMA: 'RationalTime.1',
                      value: 1_000_000,
                      rate: 1_000_000,
                    },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 4_000_000, rate: 1_000_000 },
                  },
                  metadata: {
                    gran: {
                      sourceDurationUs: 9_000_000,
                    },
                  },
                },
              ],
            },
          ],
        },
        metadata: { gran: { docId: 'imported-doc', timebase: { fps: 25 } } },
      }),
      { id: 'doc1', name: 'Imported', fps: 25 },
    );

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('timeline');
    expect(clip.source?.path).toBe('_timelines/external-sequence.otio');
    expect(clip.sourceDurationUs).toBe(9_000_000);
    expect(clip.sourceRange).toEqual({ startUs: 1_000_000, durationUs: 4_000_000 });
  });

  it('preserves shape clips through OTIO round-trip', () => {
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
              id: 'shape1',
              trackId: 'v1',
              name: 'Shape clip',
              clipType: 'shape',
              sourceDurationUs: 4_000_000,
              timelineRange: { startUs: 500_000, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              shapeType: 'cloud',
              fillColor: '#ff00aa',
              strokeColor: '#112233',
              strokeWidth: 6,
              opacity: 0.75,
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('shape');
    expect(clip.shapeType).toBe('cloud');
    expect(clip.fillColor).toBe('#ff00aa');
    expect(clip.strokeColor).toBe('#112233');
    expect(clip.strokeWidth).toBe(6);
    expect(clip.opacity).toBe(0.75);
  });
});
