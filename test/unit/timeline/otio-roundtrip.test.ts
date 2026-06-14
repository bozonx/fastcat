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

  it('preserves custom track order after serializing and parsing a saved timeline', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-1',
      name: 'Timeline',
      format: { fps: 30, width: 1920, height: 1080 },
    });
    const doc = {
      ...base,
      tracks: [
        { id: 'v1', kind: 'video' as const, name: 'Video 1', videoHidden: false, items: [] },
        { id: 'v3', kind: 'video' as const, name: 'Video 3', videoHidden: false, items: [] },
        { id: 'v2', kind: 'video' as const, name: 'Video 2', videoHidden: false, items: [] },
        { id: 'a2', kind: 'audio' as const, name: 'Audio 2', audioMuted: false, items: [] },
        { id: 'a1', kind: 'audio' as const, name: 'Audio 1', audioMuted: false, items: [] },
      ],
    };

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(doc), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    expect(parsed.tracks.map((track) => track.id)).toEqual(['v1', 'v3', 'v2', 'a2', 'a1']);
  });

  it('preserves free clip timing and sub-frame gaps after serializing and parsing', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-1',
      name: 'Timeline',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const doc = applyTimelineCommand(base, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'Free Clip',
      path: '_video/clip.mp4',
      startUs: 10_000,
      durationUs: 1_010_001,
      sourceDurationUs: 2_000_000,
      quantizeToFrames: false,
    }).next;

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(doc), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const track = parsed.tracks.find((candidate) => candidate.id === 'v1');
    const gap = track?.items.find((item) => item.kind === 'gap');
    const clip = track?.items.find((item): item is TimelineClipItem => item.kind === 'clip');

    expect(gap?.timelineRange).toEqual({ startUs: 0, durationUs: 10_000 });
    expect(clip?.timelineRange).toEqual({ startUs: 10_000, durationUs: 1_010_001 });
  });
});
