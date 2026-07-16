/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { serializeTimelineToOtio, parseTimelineFromOtio } from '~/timeline/otio-serializer';
import type { TimelineDocument } from '~/timeline/types';
import { TICKS_PER_MICROSECOND, TICKS_PER_SECOND } from '~/utils/time';

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
            sourceDurationUs: TICKS_PER_SECOND * 10,
            timelineRange: { startUs: 0, durationUs: TICKS_PER_SECOND * 5 },
            sourceRange: { startUs: 0, durationUs: TICKS_PER_SECOND * 5 },
            opacity: 0.5,
            blendMode: 'multiply',
            transitionIn: { type: 'dissolve', durationUs: (TICKS_PER_SECOND * 3) / 10 },
            transitionOut: { type: 'dissolve', durationUs: TICKS_PER_SECOND / 2 },
            audioGain: 1.25,
            audioFadeInUs: TICKS_PER_SECOND / 5,
            audioFadeOutUs: (TICKS_PER_SECOND * 2) / 5,
          },
        ],
      },
    ],
    metadata: {
      fastcat: {
        docId: 'doc1',
        timebase: { fps: 30 },
        markers: [
          { id: 'm1', timeUs: TICKS_PER_SECOND, text: 'Hello world' },
          { id: 'm2', timeUs: TICKS_PER_SECOND / 2, text: 'Second' },
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

    // Expected order: Transition.1 (in), Clip.2 (disabled), Transition.1 (out)
    expect(schemas).toEqual(['Transition.1', 'Clip.2', 'Transition.1']);

    const tIn = trackChildren[0];
    expect(tIn.transition_type).toBe('SMPTE_Dissolve');
    expect(tIn.metadata.fastcat.transition.type).toBe('dissolve');
    expect(tIn.metadata.fastcat.transition.durationUs).toBe((TICKS_PER_SECOND * 3) / 10);
    expect(tIn.metadata.fastcat.owner.edge).toBe('in');

    const tOut = trackChildren[2];
    expect(tOut.transition_type).toBe('SMPTE_Dissolve');
    expect(tOut.metadata.fastcat.transition.durationUs).toBe(TICKS_PER_SECOND / 2);
    expect(tOut.metadata.fastcat.owner.edge).toBe('out');
  });

  it('serializes and deserializes transitionIn and transitionOut', () => {
    const doc = makeDoc();
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

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
      durationUs: (TICKS_PER_SECOND * 3) / 10,
      curve: 'linear',
    });
    expect(clip.transitionOut).toMatchObject({
      type: 'dissolve',
      durationUs: TICKS_PER_SECOND / 2,
      curve: 'linear',
    });
    expect(clip.audioGain).toBe(1.25);
    expect(clip.audioFadeInUs).toBe(TICKS_PER_SECOND / 5);
    expect(clip.audioFadeOutUs).toBe((TICKS_PER_SECOND * 2) / 5);
  });

  it('serializes markers as OTIO Marker.2 on Stack.markers (not in metadata)', () => {
    const doc = makeDoc();
    const raw = JSON.parse(serializeTimelineToOtio(doc));

    expect(raw.markers).toBeUndefined();
    expect(Array.isArray(raw.tracks.markers)).toBe(true);
    expect(raw.tracks.markers).toHaveLength(2);
    expect(raw.tracks.markers[0].OTIO_SCHEMA).toBe('Marker.2');
    // sorted by time ascending
    expect(raw.tracks.markers[0].metadata.fastcat.marker.id).toBe('m2');
    expect(raw.tracks.markers[1].metadata.fastcat.marker.id).toBe('m1');

    // fastcat metadata should NOT contain markers array
    expect(raw.metadata.fastcat.markers).toBeUndefined();
  });

  it('parses markers from Stack.markers', () => {
    const doc = makeDoc();
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    const markers = parsed.metadata?.fastcat?.markers as any[];
    expect(markers).toHaveLength(2);
    expect(markers[0].id).toBe('m2');
    expect(markers[0].timeUs).toBe(TICKS_PER_SECOND / 2);
    expect(markers[0].text).toBe('Second');
    expect(markers[1].id).toBe('m1');
    expect(markers[1].timeUs).toBe(TICKS_PER_SECOND);
  });

  it('parses legacy markers from Timeline.markers', () => {
    const raw = JSON.parse(serializeTimelineToOtio(makeDoc()));
    raw.markers = raw.tracks.markers;
    delete raw.tracks.markers;

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    expect(parsed.metadata?.fastcat?.markers?.map((marker) => marker.id)).toEqual(['m2', 'm1']);
  });

  it('does not parse removed fastcat.markers legacy metadata', () => {
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
              metadata: { fastcat: { marker: { id: 'old-m1', color: 'red' } } },
            },
          ],
        },
      },
    };
    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'old1',
      name: 'Old',
      format: { fps: 25 },
    });
    expect(parsed.metadata?.fastcat?.markers).toEqual([]);
  });

  it('normalizes external OTIO track kinds during parse', () => {
    const raw = {
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Legacy kinds',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'Video 1',
            kind: 'Video',
            children: [],
          },
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'Audio 1',
            kind: 'audio',
            children: [],
          },
        ],
      },
      metadata: { fastcat: { docId: 'external-kinds', timebase: { fps: 25 } } },
    };

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'external-kinds',
      name: 'External kinds',
      format: { fps: 25 },
    });

    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0]?.kind).toBe('video');
    expect(parsed.tracks[1]?.kind).toBe('audio');
  });

  it('serializes video tracks with top layer last in OTIO Stack order', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      tracks: [
        { id: 'v2', kind: 'video', name: 'Video 2', items: [] },
        { id: 'v1', kind: 'video', name: 'Video 1', items: [] },
        { id: 'a1', kind: 'audio', name: 'Audio 1', items: [] },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));

    expect(raw.tracks.children.map((track: any) => track.metadata.fastcat.id)).toEqual([
      'v1',
      'v2',
      'a1',
    ]);
  });

  it('preserves track-level markers through OTIO round-trip', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [],
          markers: [
            {
              id: 'tm1',
              timeUs: (TICKS_PER_SECOND * 3) / 10,
              durationUs: TICKS_PER_SECOND / 10,
              text: 'Track mark',
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    expect(raw.tracks.children[0].markers[0].metadata.fastcat.marker.id).toBe('tm1');

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    expect(parsed.tracks[0]?.markers).toEqual([
      {
        id: 'tm1',
        timeUs: (TICKS_PER_SECOND * 3) / 10,
        durationUs: TICKS_PER_SECOND / 10,
        text: 'Track mark',
      },
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
              sourceDurationUs: 10 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              transitionIn: {
                type: 'clock',
                durationUs: 300_000 * TICKS_PER_MICROSECOND,
                mode: 'background' as const,
                curve: 'smooth',
                params: { direction: 'counterclockwise' },
              },
              transitionOut: {
                type: 'wipe',
                durationUs: 500_000 * TICKS_PER_MICROSECOND,
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
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    const clip = parsed.tracks[0]?.items[0] as any;
    expect(clip.transitionIn).toMatchObject({
      type: 'clock',
      durationUs: 300_000 * TICKS_PER_MICROSECOND,
      mode: 'background',
      curve: 'smooth',
      params: { direction: 'counterclockwise' },
    });
    expect(clip.transitionOut).toMatchObject({
      type: 'wipe',
      durationUs: 500_000 * TICKS_PER_MICROSECOND,
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
              sourceDurationUs: 10 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              transitionIn: {
                type: 'clock',
                durationUs: 300_000 * TICKS_PER_MICROSECOND,
                mode: 'background' as const,
              },
              transitionOut: {
                type: 'wipe',
                durationUs: 500_000 * TICKS_PER_MICROSECOND,
                mode: 'adjacent' as const,
              },
            },
          ],
        },
      ],
    };

    const serialized = JSON.parse(serializeTimelineToOtio(doc)) as any;
    const transitionNodes = serialized.tracks.children[0].children.filter(
      (c: any) => c.OTIO_SCHEMA === 'Transition.1',
    );
    transitionNodes[0].metadata.fastcat.transition.mode = 'invalid_mode';
    transitionNodes[1].metadata.fastcat.transition.mode = 'also_invalid';

    const parsed = parseTimelineFromOtio(JSON.stringify(serialized), {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
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
              sourceDurationUs: 10 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
            },
          ],
        },
      ],
    };
    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

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
      format: { fps: 24 },
    });
    const clips = parsed.tracks[0]?.items.filter((i: any) => i.kind === 'clip') as any[];

    expect(clips).toHaveLength(2);
    // Transition attributed as transitionOut of clip A and transitionIn of clip B
    const clipA = clips[0];
    const clipB = clips[1];
    expect(clipA.transitionOut?.type).toBe('dissolve');
    expect(clipB.transitionIn?.type).toBe('dissolve');

    const expectedDurationUs = TICKS_PER_SECOND / 2;
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
              sourceDurationUs: 5 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
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
    const clipNode = raw.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1' || c.OTIO_SCHEMA === 'Clip.2',
    );

    expect(Array.isArray(clipNode.effects)).toBe(true);
    expect(clipNode.effects).toHaveLength(2);
    expect(clipNode.effects[0].OTIO_SCHEMA).toBe('Effect.1');
    expect(clipNode.effects[0].name).toBe('blur');
    expect(clipNode.effects[0].effect_name).toBe('fastcat:blur');
    expect(clipNode.effects[0].enabled).toBe(true);
    expect(clipNode.effects[0].metadata.fastcat.effect.params.radius).toBe(10);
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
              sourceDurationUs: 5 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              effects: [{ id: 'ce1', type: 'blur', enabled: true, radius: 8 }],
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

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
              sourceDurationUs: 20 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 2 * TICKS_PER_SECOND, durationUs: 5 * TICKS_PER_SECOND },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1' || c.OTIO_SCHEMA === 'Clip.2',
    );

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

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'ext1',
      name: 'Ext',
      format: { fps: 24 },
    });
    const clip = parsed.tracks[0]?.items[0] as any;

    // 240 frames at 24fps = 10 seconds.
    expect(clip.sourceDurationUs).toBe(TICKS_PER_SECOND * 10);
    // source_range: 24 frames at 24fps = 1 second
    expect(clip.sourceRange.durationUs).toBe(TICKS_PER_SECOND);
  });

  it('prefers ExternalReference available_range over duplicated fastcat source duration', () => {
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
                metadata: {
                  fastcat: {
                    id: 'c1',
                    clipType: 'media',
                    source: { durationUs: 123 },
                  },
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
      name: 'Ext',
      format: { fps: 24 },
    });
    const clip = parsed.tracks[0]?.items[0] as any;

    expect(clip.sourceDurationUs).toBe(TICKS_PER_SECOND * 10);
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
              timelineRange: { startUs: 0, durationUs: 3 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 3 * TICKS_PER_SECOND },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1' || c.OTIO_SCHEMA === 'Clip.2',
    );

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
              sourceDurationUs: 12 * TICKS_PER_SECOND,
              timelineRange: { startUs: TICKS_PER_SECOND, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 2 * TICKS_PER_SECOND, durationUs: 5 * TICKS_PER_SECOND },
              audioGain: 0.75,
              audioFadeInUs: 150_000 * TICKS_PER_MICROSECOND,
              audioFadeOutUs: 250_000 * TICKS_PER_MICROSECOND,
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('timeline');
    expect(clip.source?.path).toBe('_timelines/sequence.otio');
    expect(clip.sourceDurationUs).toBe(12 * TICKS_PER_SECOND);
    expect(clip.sourceRange).toEqual({
      startUs: 2 * TICKS_PER_SECOND,
      durationUs: 5 * TICKS_PER_SECOND,
    });
    expect(clip.audioGain).toBe(0.75);
    expect(clip.audioFadeInUs).toBe(150_000 * TICKS_PER_MICROSECOND);
    expect(clip.audioFadeOutUs).toBe(250_000 * TICKS_PER_MICROSECOND);
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
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'imported-doc', timebase: { fps: 25 } } },
      }),
      { id: 'doc1', name: 'Imported', format: { fps: 25 } },
    );

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('timeline');
    expect(clip.source?.path).toBe('_timelines/external-sequence.otio');
    expect(clip.sourceDurationUs).toBe(TICKS_PER_SECOND * 4);
    expect(clip.sourceRange).toEqual({
      startUs: TICKS_PER_SECOND,
      durationUs: TICKS_PER_SECOND * 4,
    });
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
    expect(raw.metadata.fastcat.document.timebase).toEqual({ num: 30_000, den: 1_001 });

    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc-ntsc',
      name: 'NTSC',
      format: { fps: 29.97 },
    });
    expect(parsed.timebase).toEqual({ num: 30_000, den: 1_001 });
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
              sourceDurationUs: TICKS_PER_SECOND * 2,
              timelineRange: { startUs: 0, durationUs: TICKS_PER_SECOND * 2 },
              sourceRange: { startUs: 0, durationUs: TICKS_PER_SECOND * 2 },
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    const clipNode = raw.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1' || c.OTIO_SCHEMA === 'Clip.2',
    );
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
              sourceDurationUs: 4 * TICKS_PER_SECOND,
              timelineRange: {
                startUs: 500_000 * TICKS_PER_MICROSECOND,
                durationUs: 2 * TICKS_PER_SECOND,
              },
              sourceRange: { startUs: 0, durationUs: 2 * TICKS_PER_SECOND },
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
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

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
              timelineRange: {
                startUs: 250_000 * TICKS_PER_MICROSECOND,
                durationUs: 3 * TICKS_PER_SECOND,
              },
              sourceRange: { startUs: 0, durationUs: 3 * TICKS_PER_SECOND },
              background: { source: { path: 'assets/background.png' } },
              content: { source: { path: 'assets/content.png' } },
              opacity: 0.8,
            },
          ],
        },
      ],
    };

    const serialized = serializeTimelineToOtio(doc);
    const parsed = parseTimelineFromOtio(serialized, {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });

    const clip = parsed.tracks[0]?.items.find((item: any) => item.kind === 'clip') as any;
    expect(clip.clipType).toBe('hud');
    expect(clip.hudType).toBe('media_frame');
    expect(clip.background).toEqual({ source: { path: 'assets/background.png' } });
    expect(clip.content).toEqual({ source: { path: 'assets/content.png' } });
    expect(clip.opacity).toBe(0.8);
  });

  it('preserves all FastCat v2 metadata groups through OTIO round-trip', () => {
    const doc: TimelineDocument = {
      ...makeDoc(),
      metadata: {
        fastcat: {
          docId: 'doc1',
          timebase: { fps: 30 },
          masterGain: 0.7,
          masterMuted: true,
          masterEffects: [{ id: 'me1', type: 'limiter', enabled: true, threshold: -2 }],
        },
      },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          videoHidden: true,
          opacity: 0.65,
          blendMode: 'screen',
          audioMuted: true,
          audioSolo: true,
          audioGain: 0.8,
          audioBalance: -0.25,
          color: '#123456',
          locked: true,
          items: [
            {
              kind: 'clip',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip1',
              clipType: 'media',
              source: { path: 'file.mp4' },
              sourceDurationUs: 10 * TICKS_PER_SECOND,
              timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
              locked: true,
              speed: 1.25,
              speedActive: true,
              audioGain: 1.1,
              audioBalance: 0.2,
              audioFadeInUs: 100_000 * TICKS_PER_MICROSECOND,
              audioFadeOutUs: 200_000 * TICKS_PER_MICROSECOND,
              audioFadeInCurve: 'logarithmic',
              audioFadeOutCurve: 'linear',
              audioFadesActive: true,
              audioMuted: true,
              audioWaveformMode: 'full',
              showWaveform: false,
              showThumbnails: false,
              freezeFrameSourceUs: 300_000 * TICKS_PER_MICROSECOND,
              opacity: 0.4,
              opacityActive: true,
              blendMode: 'multiply',
              blendModeActive: true,
              transform: {
                scale: { x: -1.2, y: 1.2, linked: true },
                rotationDeg: 15,
                position: { x: 12, y: -34 },
                anchor: { preset: 'custom', x: 0.25, y: 0.75 },
                crop: { top: 10, bottom: 20, left: 30, right: 40 },
              },
              transformActive: true,
              mask: { source: { path: 'mask.png' }, mode: 'luma', invert: true },
              maskActive: true,
              linkedGroupId: 'lg1',
              isImage: true,
              disabled: true,
            },
          ],
        },
      ],
    };

    const raw = JSON.parse(serializeTimelineToOtio(doc));
    expect(raw.metadata.fastcat.version).toBe(2);
    expect(raw.metadata.fastcat.audio.masterGain).toBe(0.7);
    expect(raw.metadata.fastcat.audio.masterMuted).toBe(true);
    expect(raw.metadata.fastcat.masterGain).toBeUndefined();

    const clipNode = raw.tracks.children[0].children.find(
      (c: any) => c.OTIO_SCHEMA === 'Clip.1' || c.OTIO_SCHEMA === 'Clip.2',
    );
    expect(clipNode.metadata.fastcat.audio.gain).toBe(1.1);
    expect(clipNode.metadata.fastcat.visual.opacity).toBe(0.4);
    expect(clipNode.metadata.fastcat.flags.transformActive).toBe(true);
    expect(clipNode.metadata.fastcat.flags.speedActive).toBe(true);
    expect(clipNode.metadata.fastcat.flags.audioFadesActive).toBe(true);
    expect(clipNode.metadata.fastcat.flags.opacityActive).toBe(true);
    expect(clipNode.metadata.fastcat.flags.blendModeActive).toBe(true);
    expect(clipNode.metadata.fastcat.flags.maskActive).toBe(true);
    expect(clipNode.metadata.fastcat.transform.crop).toEqual({
      top: 10,
      bottom: 20,
      left: 30,
      right: 40,
    });
    expect(clipNode.metadata.fastcat.roundtrip.timelineRange).toEqual({
      startUs: 0,
      durationUs: 5 * TICKS_PER_SECOND,
    });
    expect(clipNode.metadata.fastcat.roundtrip.sourceRange).toEqual({
      startUs: 0,
      durationUs: 5 * TICKS_PER_SECOND,
    });

    const parsed = parseTimelineFromOtio(JSON.stringify(raw), {
      id: 'doc1',
      name: 'Test',
      format: { fps: 30 },
    });
    const parsedTrack = parsed.tracks[0] as any;
    const parsedClip = parsedTrack.items[0] as any;

    expect(parsed.metadata?.fastcat?.masterGain).toBe(0.7);
    expect(parsed.metadata?.fastcat?.masterMuted).toBe(true);
    expect(parsed.metadata?.fastcat?.masterEffects).toEqual([
      { id: 'me1', type: 'limiter', enabled: true, threshold: -2 },
    ]);
    expect(parsedTrack.videoHidden).toBe(true);
    expect(parsedTrack.opacity).toBe(0.65);
    expect(parsedTrack.blendMode).toBe('screen');
    expect(parsedTrack.audioMuted).toBe(true);
    expect(parsedTrack.audioSolo).toBe(true);
    expect(parsedTrack.audioGain).toBe(0.8);
    expect(parsedTrack.audioBalance).toBe(-0.25);
    expect(parsedTrack.color).toBe('#123456');
    expect(parsedTrack.locked).toBe(true);
    // speedActive is restored from the canonical LinearTimeWarp effect.
    expect(parsedClip.speedActive).toBe(true);
    expect(parsedClip.audioFadesActive).toBe(true);
    expect(parsedClip.showThumbnails).toBe(false);
    expect(parsedClip.opacityActive).toBe(true);
    expect(parsedClip.blendModeActive).toBe(true);
    expect(parsedClip.transformActive).toBe(true);
    expect(parsedClip.maskActive).toBe(true);
    // disabled/ignored unified: ignored was removed, disabled is used instead
    expect(parsedClip.disabled).toBe(true);
    expect(parsedClip.ignored).toBeUndefined();
    expect(parsedClip.transform.crop).toEqual({ top: 10, bottom: 20, left: 30, right: 40 });
  });
});
