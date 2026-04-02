/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { serializeTimelineToOtio, parseTimelineFromOtio } from '~/timeline/otio-serializer';
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
      fastcat: {
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

describe('timeline/otio-serializer: transitions', () => {
  it('serializes transitions as OTIO Transition.1 in Track.children', () => {
    const doc = makeDoc();
    const raw = JSON.parse(serializeTimelineToOtio(doc));

    const trackChildren = raw.tracks.children[0].children as any[];
    const schemas = trackChildren.map((c: any) => c.OTIO_SCHEMA);

    // Expected order: Transition.1 (in), Clip.1, Transition.1 (out)
    expect(schemas).toEqual(['Transition.1', 'Clip.1', 'Transition.1']);

    const tIn = trackChildren[0];
    expect(tIn.transition_type).toBe('SMPTE_Dissolve');
    expect(tIn.metadata.fastcat.type).toBe('dissolve');
    expect(tIn.metadata.fastcat.durationUs).toBe(300_000);

    const tOut = trackChildren[2];
    expect(tOut.transition_type).toBe('SMPTE_Dissolve');
    expect(tOut.metadata.fastcat.durationUs).toBe(500_000);
  });

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
    expect(clip.transitionIn).toMatchObject({
      type: 'dissolve',
      durationUs: 300_000,
      curve: 'linear',
    });
    expect(clip.transitionOut).toMatchObject({
      type: 'dissolve',
      durationUs: 500_000,
      curve: 'linear',
    });
    expect(clip.audioGain).toBe(1.25);
    expect(clip.audioFadeInUs).toBe(200_000);
    expect(clip.audioFadeOutUs).toBe(400_000);
  });

  it('serializes markers as OTIO Marker.2 on Timeline.markers (not in metadata)', () => {
    const doc = makeDoc();
    const raw = JSON.parse(serializeTimelineToOtio(doc));

    expect(Array.isArray(raw.markers)).toBe(true);
    expect(raw.markers).toHaveLength(2);
    expect(raw.markers[0].OTIO_SCHEMA).toBe('Marker.2');
    // sorted by time ascending
    expect(raw.markers[0].metadata.fastcat.id).toBe('m2');
    expect(raw.markers[1].metadata.fastcat.id).toBe('m1');

    // fastcat metadata should NOT contain markers array
    expect(raw.metadata.fastcat.markers).toBeUndefined();
  });

  it('parses markers from Timeline.markers', () => {
    const doc = makeDoc();
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const markers = parsed.metadata?.fastcat?.markers as any[];
    expect(markers).toHaveLength(2);
    expect(markers[0].id).toBe('m2');
    expect(markers[0].timeUs).toBe(500_000);
    expect(markers[0].text).toBe('Second');
    expect(markers[1].id).toBe('m1');
    expect(markers[1].timeUs).toBe(1_000_000);
  });

  it('falls back to fastcat.markers when Timeline.markers is absent (old format)', () => {
    const raw = {
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Old',
      tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: [] },
      metadata: {
        fastcat: {
          docId: 'old1',
          timebase: { fps: 25 },
          markers: [
            {
              OTIO_SCHEMA: 'Marker.2',
              name: 'M',
              color: 'RED',
              comment: 'Old marker',
              marked_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 2_000_000, rate: 1_000_000 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1_000_000 },
              },
              metadata: { fastcat: { id: 'old-m1', color: 'red' } },
            },
          ],
        },
      },
    };
    const parsed = parseTimelineFromOtio(JSON.stringify(raw), { id: 'old1', name: 'Old', fps: 25 });
    expect(parsed.metadata?.fastcat?.markers).toHaveLength(1);
    expect((parsed.metadata?.fastcat?.markers as any)[0].id).toBe('old-m1');
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
                mode: 'background' as const,
                curve: 'smooth',
                params: { direction: 'counterclockwise' },
              },
              transitionOut: {
                type: 'wipe',
                durationUs: 500_000,
                mode: 'adjacent' as const,
                curve: 'linear',
                params: { direction: 'right', gap: 0.04, gapColor: '#00ff00' },
              },
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.transitionIn).toMatchObject({
      type: 'clock',
      durationUs: 300_000,
      mode: 'background',
      curve: 'smooth',
      params: { direction: 'counterclockwise' },
    });
    expect(clip.transitionOut).toMatchObject({
      type: 'wipe',
      durationUs: 500_000,
      mode: 'adjacent',
      curve: 'linear',
      params: { direction: 'right', gap: 0.04, gapColor: '#00ff00' },
    });
  });

  it('normalizes invalid transition modes on parse via fastcat metadata', () => {
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
              transitionIn: { type: 'clock', durationUs: 300_000, mode: 'background' as const },
              transitionOut: { type: 'wipe', durationUs: 500_000, mode: 'adjacent' as const },
            },
          ],
        },
      ],
    };

    const serialized = JSON.parse(serializeTimelineToOtio(doc)) as any;
    // Find the clip node (index 1: Transition.1, Clip.1, Transition.1)
    const clipNode = serialized.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1',
    );
    clipNode.metadata.fastcat.transitionIn = {
      type: 'clock',
      durationUs: 300_000,
      mode: 'invalid_mode',
    };
    clipNode.metadata.fastcat.transitionOut = {
      type: 'wipe',
      durationUs: 500_000,
      mode: 'also_invalid',
    };
    // Also corrupt the Transition.1 nodes' fastcat mode to confirm fastcat wins
    const tIn = serialized.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Transition.1' && c.name.includes('_in'),
    );
    if (tIn) tIn.metadata.fastcat.mode = 'invalid_mode';

    const parsed = parseTimelineFromOtio(JSON.stringify(serialized), {
      id: 'doc1',
      name: 'Test',
      fps: 30,
    });
    const clip = parsed.tracks[0]?.items[0] as any;

    // Invalid modes normalize to DEFAULT_TRANSITION_MODE
    expect(['adjacent', 'background', 'transparent']).toContain(clip.transitionIn.mode);
    expect(['adjacent', 'background', 'transparent']).toContain(clip.transitionOut.mode);
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

  it('imports Transition.1 from external OTIO without fastcat metadata', () => {
    const raw = {
      OTIO_SCHEMA: 'Timeline.1',
      name: 'External',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'A',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'a.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 50, rate: 24 },
                },
              },
              {
                OTIO_SCHEMA: 'Transition.1',
                name: 't1',
                transition_type: 'SMPTE_Dissolve',
                parameters: {},
                in_offset: { OTIO_SCHEMA: 'RationalTime.1', value: 6, rate: 24 },
                out_offset: { OTIO_SCHEMA: 'RationalTime.1', value: 6, rate: 24 },
                metadata: {},
              },
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'B',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'b.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 50, rate: 24 },
                },
              },
            ],
            metadata: { fastcat: { id: 'v1' } },
          },
        ],
      },
      metadata: { fastcat: { docId: 'ext1', timebase: { fps: 24 } } },
    };

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'ext1',
      name: 'External',
      fps: 24,
    });
    const clips = parsed.tracks[0]?.items.filter((i: any) => i.kind === 'clip') as any[];

    expect(clips).toHaveLength(2);
    // Transition attributed as transitionOut of clip A and transitionIn of clip B
    const clipA = clips[0];
    const clipB = clips[1];
    expect(clipA.transitionOut?.type).toBe('dissolve');
    expect(clipB.transitionIn?.type).toBe('dissolve');

    const expectedDurationUs = Math.round((12 / 24) * 1_000_000);
    expect(clipA.transitionOut?.durationUs).toBe(expectedDurationUs);
  });

  it('serializes effects as OTIO Effect.1 on clips', () => {
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
              sourceDurationUs: 5_000_000,
              timelineRange: { startUs: 0, durationUs: 5_000_000 },
              sourceRange: { startUs: 0, durationUs: 5_000_000 },
              effects: [
                { id: 'e1', type: 'blur', enabled: true, radius: 10 },
                { id: 'e2', type: 'color_correction', enabled: false, brightness: 1.2 },
              ],
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find((c: any) => c.OTIO_SCHEMA === 'Clip.1');

    expect(Array.isArray(clipNode.effects)).toBe(true);
    expect(clipNode.effects).toHaveLength(2);
    expect(clipNode.effects[0].OTIO_SCHEMA).toBe('Effect.1');
    expect(clipNode.effects[0].effect_name).toBe('blur');
    expect(clipNode.effects[0].enabled).toBe(true);
    expect(clipNode.effects[0].metadata.fastcat.params.radius).toBe(10);
    expect(clipNode.effects[1].enabled).toBe(false);
  });

  it('round-trips effects through OTIO', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          effects: [{ id: 'te1', type: 'vignette', enabled: true, strength: 0.5 }],
          items: [
            {
              kind: 'clip',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip1',
              clipType: 'media',
              source: { path: 'file.mp4' },
              sourceDurationUs: 5_000_000,
              timelineRange: { startUs: 0, durationUs: 5_000_000 },
              sourceRange: { startUs: 0, durationUs: 5_000_000 },
              effects: [{ id: 'ce1', type: 'blur', enabled: true, radius: 8 }],
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.effects).toHaveLength(1);
    expect(clip.effects[0].id).toBe('ce1');
    expect(clip.effects[0].type).toBe('blur');
    expect(clip.effects[0].enabled).toBe(true);
    expect(clip.effects[0].radius).toBe(8);

    const track = parsed.tracks[0] as any;
    expect(track.effects).toHaveLength(1);
    expect(track.effects[0].id).toBe('te1');
    expect(track.effects[0].strength).toBe(0.5);
  });

  it('serializes ExternalReference with available_range', () => {
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
              source: { path: 'video.mp4' },
              sourceDurationUs: 20_000_000,
              timelineRange: { startUs: 0, durationUs: 5_000_000 },
              sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find((c: any) => c.OTIO_SCHEMA === 'Clip.1');

    expect(clipNode.media_reference.OTIO_SCHEMA).toBe('ExternalReference.1');
    expect(clipNode.media_reference.available_range).toBeDefined();
    expect(clipNode.media_reference.available_range.OTIO_SCHEMA).toBe('TimeRange.1');
  });

  it('uses available_range from ExternalReference as sourceDuration fallback on import', () => {
    const raw = {
      OTIO_SCHEMA: 'Timeline.1',
      name: 'External',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'C1',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'clip.mp4',
                  available_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 240, rate: 24 },
                  },
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 24, rate: 24 },
                },
                metadata: { fastcat: { id: 'c1', clipType: 'media' } },
              },
            ],
            metadata: { fastcat: { id: 'v1' } },
          },
        ],
      },
      metadata: { fastcat: { docId: 'ext1', timebase: { fps: 24 } } },
    };

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), { id: 'ext1', name: 'Ext', fps: 24 });
    const clip = parsed.tracks[0]?.items[0] as any;

    // 240 frames at 24fps = 10 seconds = 10_000_000 us
    expect(clip.sourceDurationUs).toBe(10_000_000);
    // source_range: 24 frames at 24fps = 1 second
    expect(clip.sourceRange.durationUs).toBe(1_000_000);
  });

  it('serializes clips without path as MissingReference', () => {
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
              id: 'bg1',
              trackId: 'v1',
              name: 'BG',
              clipType: 'background',
              backgroundColor: '#123456',
              timelineRange: { startUs: 0, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find((c: any) => c.OTIO_SCHEMA === 'Clip.1');

    expect(clipNode.media_reference.OTIO_SCHEMA).toBe('MissingReference.1');
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

  it('infers nested timeline clip from .otio target_url without fastcat clipType', () => {
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
                  metadata: { fastcat: { sourceDurationUs: 9_000_000 } },
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'imported-doc', timebase: { fps: 25 } } },
      }),
      { id: 'doc1', name: 'Imported', fps: 25 },
    );

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('timeline');
    expect(clip.source?.path).toBe('_timelines/external-sequence.otio');
    expect(clip.sourceDurationUs).toBe(9_000_000);
    expect(clip.sourceRange).toEqual({ startUs: 1_000_000, durationUs: 4_000_000 });
  });

  it('preserves fractional fps through OTIO round-trip', () => {
    const doc: TimelineDocument = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-ntsc',
      name: 'NTSC',
      timebase: { fps: 29.97 },
      tracks: [],
      metadata: { fastcat: { docId: 'doc-ntsc', timebase: { fps: 29.97 } } },
    };

    const serialized = serializeTimelineToOtio(doc);
    const raw = JSON.parse(serialized);
    expect(raw.metadata.fastcat.timebase.fps).toBe(29.97);

    const parsed = parseTimelineFromOtio(serialized, { id: 'doc-ntsc', name: 'NTSC', fps: 29.97 });
    expect(parsed.timebase.fps).toBe(29.97);
  });

  it('uses fps-aware RationalTime when fps is known', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      timebase: { fps: 24 },
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
              sourceDurationUs: 2_000_000,
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find((c: any) => c.OTIO_SCHEMA === 'Clip.1');
    const rate = clipNode.source_range.duration.rate;

    expect(rate).toBe(24);
    expect(clipNode.source_range.duration.value).toBe(48); // 2s at 24fps
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

  it('preserves hud media frame clips through OTIO round-trip', () => {
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
              id: 'hud1',
              trackId: 'v1',
              name: 'HUD frame',
              clipType: 'hud',
              hudType: 'media_frame',
              timelineRange: { startUs: 250_000, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
              background: { source: { path: 'assets/background.png' } },
              content: { source: { path: 'assets/content.png' } },
              opacity: 0.8,
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, { id: 'doc1', name: 'Test', fps: 30 });

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('hud');
    expect(clip.hudType).toBe('media_frame');
    expect(clip.background).toEqual({ source: { path: 'assets/background.png' } });
    expect(clip.content).toEqual({ source: { path: 'assets/content.png' } });
    expect(clip.opacity).toBe(0.8);
  });
});
