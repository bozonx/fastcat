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

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.source.path).toBe('audio/y.mp3');
    expect(result.items[0]!.audioGain).toBe(3); // 1.5 * 2 = 3
  });

  it('uses default clip audio parameters when the clip audio block is disabled', () => {
    const item = {
      kind: 'clip',
      clipType: 'media',
      id: 'c1',
      trackId: 'a1',
      name: 'clip1',
      timelineRange: { startUs: 0, durationUs: 1_000_000 },
      sourceRange: { startUs: 0, durationUs: 1_000_000 },
      source: { path: 'audio/y.mp3' },
      sourceDurationUs: 1_000_000,
      audioFadesActive: false,
      audioGain: 0.25,
      audioBalance: -0.5,
      audioFadeInUs: 100_000,
      audioFadeOutUs: 200_000,
      audioFadeInCurve: 'logarithmic',
      audioFadeOutCurve: 'logarithmic',
    };
    const audioTrack = {
      id: 'a1',
      kind: 'audio',
      name: 'A1',
      items: [item],
      audioGain: 1.5,
      audioBalance: 0.25,
    };

    const result = buildEffectiveAudioClipItems({
      audioTracks: [audioTrack as any],
      videoTracks: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.audioGain).toBe(1.5);
    expect(result.items[0]!.audioBalance).toBe(0.25);
    expect(result.items[0]!.originalAudioGain).toBe(1);
    expect(result.items[0]!.originalAudioBalance).toBe(0);
    expect(result.items[0]!.audioFadeInUs).toBeUndefined();
    expect(result.items[0]!.audioFadeOutUs).toBeUndefined();
    expect(result.items[0]!.audioFadeInCurve).toBeUndefined();
    expect(result.items[0]!.audioFadeOutCurve).toBeUndefined();
    expect(item.audioGain).toBe(0.25);
    expect(item.audioFadeInUs).toBe(100_000);
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

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('c1__audio');
    expect(result.items[0]!.source.path).toBe('video/x.mp4');
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

    expect(result.items).toHaveLength(0);
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

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.source.path).toBe('audio/y.mp3');
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

    expect(result.items).toHaveLength(0);
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

    expect(result.items).toHaveLength(0);
  });

  it('ignores image and svg clips on video tracks', () => {
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
          name: 'image1',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'images/map.png' },
          sourceDurationUs: 1_000_000,
          audioGain: 1,
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c2',
          trackId: 'v1',
          name: 'image2',
          timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
          source: { path: 'images/icon.svg' },
          sourceDurationUs: 1_000_000,
          audioGain: 1,
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c3',
          trackId: 'v1',
          name: 'video1',
          timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 },
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

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('c3__audio');
    expect(result.items[0]!.source.path).toBe('video/x.mp4');
  });

  it('master audio effects are not merged into clips', () => {
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
          effects: [{ id: 'fx1', type: 'eq', enabled: true, target: 'audio' }],
        },
      ],
    };

    const masterEffects = [
      { id: 'm1', type: 'reverb', enabled: true, target: 'audio' },
      { id: 'mv1', type: 'video-lut', enabled: true, target: 'video' },
    ];

    const result = buildEffectiveAudioClipItems({
      audioTracks: [audioTrack as any],
      videoTracks: [],
      masterEffects: masterEffects as any,
    });

    expect(result.items).toHaveLength(1);
    // Clip effects should only contain the clip's own effects
    expect(result.items[0]!.effects).toHaveLength(1);
    expect(result.items[0]!.effects![0]!.id).toBe('fx1');
    // masterAudioEffects should only contain audio master effects
    expect(result.masterAudioEffects).toHaveLength(1);
    expect(result.masterAudioEffects[0]!.id).toBe('m1');
  });
});
