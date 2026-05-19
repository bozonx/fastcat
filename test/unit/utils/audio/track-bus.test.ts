/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';

describe('buildEffectiveAudioClipItems', () => {
  it('builds effective items from audio tracks', () => {
    const audioTrack = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'a1',
          name: 'clip1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'audio/y.mp3' },
          sourceDurationUs: 1_000_000,
          audioGain: 2,
        },
      ],
      audioGain: 1.5,
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [audioTrack as any],
      videoTracks: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.source.path).toBe('audio/y.mp3');
    expect(result[0]!.audioGain).toBe(3); // 1.5 * 2 = 3
  });

  it('builds effective items from video tracks when audio from video is enabled', () => {
    const videoTrack = {
      id: 'v1',
      kind: 'video',
      name: 'V1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          name: 'clip1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'video/x.mp4' },
          sourceDurationUs: 1_000_000,
          audioGain: 1,
        },
      ],
      audioGain: 1,
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [],
      videoTracks: [videoTrack as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('c1__audio');
    expect(result[0]!.source.path).toBe('video/x.mp4');
  });

  it('ignores muted tracks', () => {
    const track = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'a1',
          name: 'clip1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'audio/y.mp3' },
          sourceDurationUs: 1_000_000,
        },
      ],
      audioMuted: true,
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [track as any],
      videoTracks: [],
    });

    expect(result).toHaveLength(0);
  });

  it('only includes solo tracks when any track is soloed', () => {
    const soloTrack = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'a1',
          name: 'clip1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'audio/y.mp3' },
          sourceDurationUs: 1_000_000,
        },
      ],
      audioSolo: true,
    };

    const normalTrack = {
      id: 'a2',
      kind: 'audio',
      name: 'A2',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c2',
          trackId: 'a2',
          name: 'clip2',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'audio/z.mp3' },
          sourceDurationUs: 1_000_000,
        },
      ],
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [soloTrack as any, normalTrack as any],
      videoTracks: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.source.path).toBe('audio/y.mp3');
  });

  it('ignores clips without source path', () => {
    const track = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'a1',
          name: 'clip1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          sourceDurationUs: 1_000_000,
        },
      ],
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [track as any],
      videoTracks: [],
    });

    expect(result).toHaveLength(0);
  });

  it('ignores non-media clip types', () => {
    const track = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [
        {
          kind: 'clip',
          clipType: 'text',
          id: 'c1',
          trackId: 'a1',
          name: 'text1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          text: 'hello',
        },
      ],
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [track as any],
      videoTracks: [],
    });

    expect(result).toHaveLength(0);
  });
});
