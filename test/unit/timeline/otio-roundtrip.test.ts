/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  createDefaultTimelineDocument,
  parseTimelineFromOtio,
  serializeTimelineToOtio,
} from '~/timeline/otio-serializer';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineClipItem } from '~/timeline/types';

describe('timeline OTIO roundtrip', () => {
  it('keeps tracks and clips after serializing and parsing a saved timeline', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-1',
      name: 'Timeline',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const doc = applyTimelineCommand(base, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'Clip',
      path: '_video/clip.mp4',
      startUs: 0,
      durationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
    }).next;

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(doc), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const clip = parsed.tracks
      .flatMap((track) => track.items)
      .find((item): item is TimelineClipItem => item.kind === 'clip');

    expect(parsed.tracks).toHaveLength(4);
    expect(clip?.name).toBe('Clip');
    expect(clip?.source?.path).toBe('_video/clip.mp4');
  });
});
