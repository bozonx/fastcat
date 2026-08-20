/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { TICKS_PER_MILLISECOND, TICKS_PER_SECOND } from '~/utils/time';

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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'audio/y.mp3' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
      timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
      sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
      source: { path: 'audio/y.mp3' },
      sourceDurationTicks: TICKS_PER_SECOND,
      audioFadesActive: false,
      audioGain: 0.25,
      audioBalance: -0.5,
      audioFadeInTicks: 100 * TICKS_PER_MILLISECOND,
      audioFadeOutTicks: 200 * TICKS_PER_MILLISECOND,
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
    expect(result.items[0]!.audioFadeInTicks).toBeUndefined();
    expect(result.items[0]!.audioFadeOutTicks).toBeUndefined();
    expect(result.items[0]!.audioFadeInCurve).toBeUndefined();
    expect(result.items[0]!.audioFadeOutCurve).toBeUndefined();
    expect(item.audioGain).toBe(0.25);
    expect(item.audioFadeInTicks).toBe(100 * TICKS_PER_MILLISECOND);
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'video/x.mp4' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'audio/y.mp3' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'audio/y.mp3' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'audio/z.mp3' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'images/map.png' },
          sourceDurationTicks: TICKS_PER_SECOND,
          audioGain: 1,
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c2',
          trackId: 'v1',
          name: 'image2',
          timelineRange: { startTicks: TICKS_PER_SECOND, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'images/icon.svg' },
          sourceDurationTicks: TICKS_PER_SECOND,
          audioGain: 1,
        },
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c3',
          trackId: 'v1',
          name: 'video1',
          timelineRange: { startTicks: 2 * TICKS_PER_SECOND, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'video/x.mp4' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
          timelineRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          sourceRange: { startTicks: 0, durationTicks: TICKS_PER_SECOND },
          source: { path: 'audio/y.mp3' },
          sourceDurationTicks: TICKS_PER_SECOND,
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
