/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  migrateLegacyOtioMetadataToTicks,
  TIMELINE_TICKS_DOCUMENT_VERSION,
} from '~/timeline/time-migration';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { TICKS_PER_MICROSECOND, TICKS_PER_SECOND } from '~/utils/time';

describe('migrateLegacyOtioMetadataToTicks', () => {
  it('migrates only legacy FastCat metadata time fields', () => {
    const timeline = {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: {
        fastcat: {
          version: 1,
          document: { selectionRange: { startUs: 10, endUs: 20 } },
        },
      },
      tracks: {
        children: [
          {
            metadata: {
              fastcat: {
                roundtrip: { timelineRange: { startUs: 30, durationUs: 40 } },
                animations: { opacity: { keyframes: [{ tUs: 50, value: 1 }] } },
              },
            },
            source_range: { duration: { value: 60, rate: 1_000_000 } },
          },
        ],
      },
    };

    expect(migrateLegacyOtioMetadataToTicks(timeline)).toBe(true);
    expect(timeline.metadata.fastcat.document.selectionRange).toEqual({
      startUs: 10 * TICKS_PER_MICROSECOND,
      endUs: 20 * TICKS_PER_MICROSECOND,
    });
    expect(timeline.tracks.children[0].metadata.fastcat.roundtrip.timelineRange).toEqual({
      startUs: 30 * TICKS_PER_MICROSECOND,
      durationUs: 40 * TICKS_PER_MICROSECOND,
    });
    expect(timeline.tracks.children[0].metadata.fastcat.animations.opacity.keyframes[0].tUs).toBe(
      50 * TICKS_PER_MICROSECOND,
    );
    expect(timeline.tracks.children[0].source_range.duration.value).toBe(60);
  });

  it('does not rescale current tick documents', () => {
    const timeline = {
      metadata: {
        fastcat: {
          version: TIMELINE_TICKS_DOCUMENT_VERSION,
          document: { selectionRange: { startUs: 254_016 } },
        },
      },
    };

    expect(migrateLegacyOtioMetadataToTicks(timeline)).toBe(false);
    expect(timeline.metadata.fastcat.document.selectionRange.startUs).toBe(254_016);
  });

  it('migrates legacy metadata and RationalTime values exactly once on import', () => {
    const doc = parseTimelineFromOtio(
      JSON.stringify({
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Legacy',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              kind: 'Video',
              name: 'Video 1',
              metadata: { fastcat: { id: 'v1', kind: 'video' } },
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'Clip',
                  media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: 'clip.mp4' },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1_000_000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2_000_000, rate: 1_000_000 },
                  },
                  metadata: {
                    fastcat: {
                      id: 'c1',
                      clipType: 'media',
                      source: { durationUs: 2_000_000 },
                      roundtrip: {
                        timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
                        sourceRange: { startUs: 0, durationUs: 2_000_000 },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
        metadata: {
          fastcat: { version: 1, document: { docId: 'legacy', timebase: { fps: 30 } } },
        },
      }),
      { id: 'fallback', name: 'Fallback', format: { fps: 30 } },
      { logWarnings: false },
    );

    const clip = doc.tracks[0]!.items[0]!;
    expect(doc.metadata?.fastcat?.version).toBe(TIMELINE_TICKS_DOCUMENT_VERSION);
    expect(clip.timelineRange).toEqual({ startUs: TICKS_PER_SECOND, durationUs: 2 * TICKS_PER_SECOND });
    expect(clip.sourceRange).toEqual({ startUs: 0, durationUs: 2 * TICKS_PER_SECOND });
    expect(clip.sourceDurationUs).toBe(2 * TICKS_PER_SECOND);
  });
});
