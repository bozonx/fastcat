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

  it('preserves keyframe animations through save + parse', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-1',
      name: 'Timeline',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const added = applyTimelineCommand(base, {
      type: 'add_clip_to_track',
      trackId: 'v1',
      name: 'Clip',
      path: '_video/clip.mp4',
      startUs: 0,
      durationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
    }).next;

    const clipId = added.tracks
      .flatMap((t) => t.items)
      .find((it) => it.kind === 'clip')!.id;

    const doc = applyTimelineCommand(added, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: clipId,
      properties: {
        animations: {
          opacity: {
            keyframes: [
              { tUs: 0, value: 0, easing: 'ease' },
              { tUs: 500_000, value: 1, easing: 'linear' },
            ],
          },
          'transform.rotationDeg': {
            keyframes: [{ tUs: 0, value: 90, easing: 'hold' }],
          },
        },
      },
    }).next;

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(doc), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const clip = parsed.tracks
      .flatMap((track) => track.items)
      .find((item): item is TimelineClipItem => item.kind === 'clip');

    expect(clip?.animations?.opacity?.keyframes).toEqual([
      { tUs: 0, value: 0, easing: 'ease' },
      { tUs: 500_000, value: 1, easing: 'linear' },
    ]);
    expect(clip?.animations?.['transform.rotationDeg']?.keyframes).toEqual([
      { tUs: 0, value: 90, easing: 'hold' },
    ]);
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

  it('preserves parameter block active flags after serializing and parsing', () => {
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

    const track = doc.tracks.find((t) => t.id === 'v1');
    const clip = track?.items.find((i): i is TimelineClipItem => i.kind === 'clip');
    expect(clip).toBeDefined();

    // Set all *Active flags to true via updateClipProperties
    const updated = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: clip!.id,
      properties: {
        speedActive: true,
        transformActive: true,
        audioFadesActive: true,
        opacityActive: true,
        blendModeActive: true,
        maskActive: true,
      },
    }).next;

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(updated), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const parsedClip = parsed.tracks
      .flatMap((t) => t.items)
      .find((i): i is TimelineClipItem => i.kind === 'clip');

    expect(parsedClip?.speedActive).toBe(true);
    expect(parsedClip?.transformActive).toBe(true);
    expect(parsedClip?.audioFadesActive).toBe(true);
    expect(parsedClip?.opacityActive).toBe(true);
    expect(parsedClip?.blendModeActive).toBe(true);
    expect(parsedClip?.maskActive).toBe(true);
  });

  it('preserves disabled parameter block active flags after serializing and parsing', () => {
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

    const track = doc.tracks.find((t) => t.id === 'v1');
    const clip = track?.items.find((i): i is TimelineClipItem => i.kind === 'clip');
    expect(clip).toBeDefined();

    const updated = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'v1',
      itemId: clip!.id,
      properties: {
        opacityActive: false,
        blendModeActive: false,
      },
    }).next;

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(updated), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    const parsedClip = parsed.tracks
      .flatMap((t) => t.items)
      .find((i): i is TimelineClipItem => i.kind === 'clip');

    expect(parsedClip?.opacityActive).toBe(false);
    expect(parsedClip?.blendModeActive).toBe(false);
  });
});
