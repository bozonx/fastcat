/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  createDefaultTimelineDocument,
  parseTimelineFromOtio,
  serializeTimelineToOtio,
} from '~/timeline/otio-serializer';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineClipItem } from '~/timeline/types';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('timeline OTIO roundtrip', () => {
  it('serializes video in frames and audio in samples without changing tick ranges', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-rates',
      name: 'Rates',
      format: { fps: 29.97, sampleRate: 48_000 },
    });
    const frameTicks = (TICKS_PER_SECOND * 1_001) / 30_000;
    const sampleTicks = TICKS_PER_SECOND / 48_000;
    const videoClip = {
      kind: 'clip' as const,
      clipType: 'media' as const,
      id: 'video-clip',
      trackId: 'v1',
      name: 'Video',
      source: { path: '_video/video.mp4' },
      sourceDurationUs: 20 * frameTicks,
      timelineRange: { startUs: 2 * frameTicks, durationUs: 3 * frameTicks },
      sourceRange: { startUs: 4 * frameTicks, durationUs: 3 * frameTicks },
    };
    const audioClip = {
      kind: 'clip' as const,
      clipType: 'media' as const,
      id: 'audio-clip',
      trackId: 'a1',
      name: 'Audio',
      source: { path: '_audio/audio.wav' },
      sourceDurationUs: 96_000 * sampleTicks,
      timelineRange: { startUs: 24_000 * sampleTicks, durationUs: 48_000 * sampleTicks },
      sourceRange: { startUs: 100 * sampleTicks, durationUs: 24_000 * sampleTicks },
    };
    const doc = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.id === 'v1'
          ? { ...track, items: [videoClip] }
          : track.id === 'a1'
            ? { ...track, items: [audioClip] }
            : track,
      ),
    };

    const otio = JSON.parse(serializeTimelineToOtio(doc));
    const videoTrack = otio.tracks.children.find(
      (track: { kind: string }) => track.kind === 'Video',
    );
    const audioTrack = otio.tracks.children.find(
      (track: { kind: string }) => track.kind === 'Audio',
    );
    const videoChildren = videoTrack.children as Array<{ OTIO_SCHEMA: string; source_range: any }>;
    const audioChildren = audioTrack.children as Array<{ OTIO_SCHEMA: string; source_range: any }>;
    const videoGap = videoChildren.find((child) => child.OTIO_SCHEMA === 'Gap.1');
    const videoOtioClip = videoChildren.find((child) => child.OTIO_SCHEMA === 'Clip.1');
    const audioGap = audioChildren.find((child) => child.OTIO_SCHEMA === 'Gap.1');
    const audioOtioClip = audioChildren.find((child) => child.OTIO_SCHEMA === 'Clip.1');

    expect(videoGap?.source_range.duration).toMatchObject({ value: 2, rate: 30_000 / 1_001 });
    expect(videoOtioClip?.source_range.start_time).toMatchObject({
      value: 4,
      rate: 30_000 / 1_001,
    });
    expect(videoOtioClip?.source_range.duration).toMatchObject({
      value: 3,
      rate: 30_000 / 1_001,
    });
    expect(audioGap?.source_range.duration).toMatchObject({ value: 24_000, rate: 48_000 });
    expect(audioOtioClip?.source_range.start_time).toMatchObject({ value: 100, rate: 48_000 });
    expect(audioOtioClip?.source_range.duration).toMatchObject({ value: 24_000, rate: 48_000 });

    const parsed = parseTimelineFromOtio(JSON.stringify(otio), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 29.97, sampleRate: 48_000 },
    });
    const parsedVideo = parsed.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === 'video-clip');
    const parsedAudio = parsed.tracks
      .flatMap((track) => track.items)
      .find((item) => item.id === 'audio-clip');

    expect(parsedVideo?.timelineRange).toEqual(videoClip.timelineRange);
    expect(parsedVideo?.sourceRange).toEqual(videoClip.sourceRange);
    expect(parsedAudio?.timelineRange).toEqual(audioClip.timelineRange);
    expect(parsedAudio?.sourceRange).toEqual(audioClip.sourceRange);
  });

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

  it('preserves the timeline selection range after serializing and parsing a saved timeline', () => {
    const base = createDefaultTimelineDocument({
      id: 'doc-1',
      name: 'Timeline',
      format: { fps: 30, width: 1920, height: 1080 },
    });
    const doc = {
      ...base,
      metadata: {
        ...base.metadata,
        fastcat: {
          ...base.metadata?.fastcat,
          selectionRange: { startUs: 1_000_000, endUs: 3_000_000 },
        },
      },
    };

    const parsed = parseTimelineFromOtio(serializeTimelineToOtio(doc), {
      id: 'fallback',
      name: 'Fallback',
      format: { fps: 30, width: 1920, height: 1080 },
    });

    expect(parsed.metadata?.fastcat?.selectionRange).toEqual({
      startUs: 1_000_000,
      endUs: 3_000_000,
    });
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

    const clipId = added.tracks.flatMap((t) => t.items).find((it) => it.kind === 'clip')!.id;

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

  it('preserves clip thumbnail/waveform visibility flags through serializing and parsing', () => {
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
        showThumbnails: false,
        showWaveform: false,
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

    expect(parsedClip?.showThumbnails).toBe(false);
    expect(parsedClip?.showWaveform).toBe(false);
  });
});
