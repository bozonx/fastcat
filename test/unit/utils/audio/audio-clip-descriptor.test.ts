import { describe, expect, it } from 'vitest';
import type { WorkerTimelineClip } from '~/composables/monitor/types';
import {
  buildCanonicalAudioClipDescriptor,
  sanitizeNativeAudioSpeed,
  toAudioEngineClip,
  toNativeSceneAudioLayer,
} from '~/utils/audio/audio-clip-descriptor';

interface AudioWorkerClip extends WorkerTimelineClip {
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
  originalAudioGain?: unknown;
  originalAudioBalance?: unknown;
}

function createClip(overrides: Partial<AudioWorkerClip> = {}): AudioWorkerClip {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    layer: 0,
    source: { path: 'audio/source.mp3' },
    timelineRange: { startUs: 1_000_000, durationUs: 2_500_000 },
    sourceRange: { startUs: 500_000, durationUs: 1_750_000 },
    sourceDurationUs: 8_000_000,
    speed: 2,
    audioGain: 0.75,
    audioBalance: -0.25,
    originalAudioGain: 0.5,
    originalAudioBalance: 0.2,
    audioFadeInUs: 100_000,
    audioFadeOutUs: 200_000,
    audioFadeInCurve: 'logarithmic',
    audioFadeOutCurve: 'linear',
    audioDeclickDurationUs: 5_000,
    defaultAudioFadeCurve: 'logarithmic',
    transitionIn: { type: 'dissolve', durationUs: 100_000, mode: 'adjacent' },
    transitionOut: { type: 'dissolve', durationUs: 150_000, mode: 'adjacent' },
    effects: [
      {
        id: 'audio-enabled',
        type: 'echo',
        enabled: true,
        target: 'audio',
        wet: 0.4,
        delayMs: 120,
      },
      {
        id: 'audio-disabled',
        type: 'reverb',
        enabled: false,
        target: 'audio',
        room: 0.8,
      },
      {
        id: 'video-enabled',
        type: 'blur',
        enabled: true,
        target: 'video',
        radius: 5,
      },
    ],
    ...overrides,
  };
}

describe('audio clip descriptor adapters', () => {
  it('maps one canonical descriptor to equivalent web and native timing fields', () => {
    const descriptor = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        transitionIn: undefined,
        transitionOut: undefined,
        audioDeclickDurationUs: undefined,
      }),
      sourcePath: '/project/audio/source.mp3',
    });
    const webClip = toAudioEngineClip({
      descriptor,
      fileHandle: {} as FileSystemFileHandle,
    });
    const nativeLayer = toNativeSceneAudioLayer({ descriptor });

    expect(webClip).toMatchObject({
      id: 'clip-1',
      trackId: 'track-1',
      sourcePath: '/project/audio/source.mp3',
      startUs: 1_000_000,
      durationUs: 2_500_000,
      sourceStartUs: 500_000,
      sourceRangeDurationUs: 1_750_000,
      sourceDurationUs: 8_000_000,
      speed: 2,
      audioFadeInUs: 100_000,
      audioFadeOutUs: 200_000,
      audioFadeInCurve: 'logarithmic',
      audioFadeOutCurve: 'linear',
    });
    expect(nativeLayer).toMatchObject({
      id: 'clip-1',
      track_id: 'track-1',
      path: '/project/audio/source.mp3',
      timeline_start_sec: 1,
      timeline_end_sec: 3.5,
      source_start_sec: 0.5,
      source_range_duration_sec: 1.75,
      speed: 2,
      audio_fade_in_sec: 0.1,
      audio_fade_out_sec: 0.2,
      audio_fade_in_curve: 'logarithmic',
      audio_fade_out_curve: 'linear',
    });
  });

  it('preserves current web/native gain and effect semantics explicitly', () => {
    const descriptor = buildCanonicalAudioClipDescriptor({
      clip: createClip(),
      sourcePath: '/project/audio/source.mp3',
    });
    const webClip = toAudioEngineClip({
      descriptor,
      fileHandle: {} as FileSystemFileHandle,
    });
    const nativeLayer = toNativeSceneAudioLayer({ descriptor });

    expect(webClip.audioGain).toBe(0.75);
    expect(webClip.audioBalance).toBe(-0.25);
    expect(webClip.audioEffects.map((effect) => effect.id)).toEqual([
      'audio-enabled',
      'audio-disabled',
    ]);

    expect(nativeLayer.audio_gain).toBe(0.5);
    expect(nativeLayer.audio_balance).toBe(0.2);
    expect(nativeLayer.audio_effects).toEqual([
      {
        id: 'audio-enabled',
        type: 'echo',
        enabled: true,
        wet: 0.4,
        params: { delayMs: 120 },
      },
    ]);
  });

  it('sanitizes native-only scalar fields without changing web fields', () => {
    const descriptor = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        speed: -150,
        audioGain: -1,
        audioBalance: 2,
        originalAudioGain: undefined,
        originalAudioBalance: undefined,
        audioFadeInUs: -10_000,
        audioFadeOutUs: Number.NaN,
        audioFadeInCurve: undefined,
        audioFadeOutCurve: undefined,
        defaultAudioFadeCurve: undefined,
        transitionIn: undefined,
        transitionOut: undefined,
        audioDeclickDurationUs: undefined,
      }),
      sourcePath: '/project/audio/source.mp3',
    });
    const webClip = toAudioEngineClip({
      descriptor,
      fileHandle: {} as FileSystemFileHandle,
    });
    const nativeLayer = toNativeSceneAudioLayer({ descriptor });

    expect(webClip.speed).toBe(-150);
    expect(webClip.audioGain).toBe(-1);
    expect(webClip.audioBalance).toBe(2);

    expect(nativeLayer.speed).toBe(-100);
    expect(nativeLayer.audio_gain).toBe(0);
    expect(nativeLayer.audio_balance).toBe(1);
    expect(nativeLayer.audio_fade_in_sec).toBe(0);
    expect(nativeLayer.audio_fade_out_sec).toBe(0);
    expect(nativeLayer.audio_fade_in_curve).toBe('linear');
    expect(nativeLayer.audio_fade_out_curve).toBe('linear');
  });

  it('resolves de-click, adjacent transitions, and neighbor context in native layer', () => {
    const descriptor = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        audioFadeInUs: undefined,
        audioFadeOutUs: undefined,
        audioDeclickDurationUs: 5_000, // 5ms auto-declick
        transitionIn: { type: 'dissolve', durationUs: 100_000, mode: 'adjacent' },
        transitionOut: { type: 'dissolve', durationUs: 150_000, mode: 'adjacent' },
      }),
      sourcePath: '/project/audio/source.mp3',
    });

    const previous = buildCanonicalAudioClipDescriptor({
      clip: createClip({ id: 'prev-clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } }),
      sourcePath: '/project/audio/prev.mp3',
    });

    const next = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        id: 'next-clip',
        timelineRange: { startUs: 3_500_000, durationUs: 1_000_000 },
      }),
      sourcePath: '/project/audio/next.mp3',
    });

    const nativeLayer = toNativeSceneAudioLayer({
      descriptor,
      previous,
      next,
    });

    expect(nativeLayer).toMatchObject({
      id: 'clip-1',
      track_id: 'track-1',
      path: '/project/audio/source.mp3',
      timeline_start_sec: 0.9,
      timeline_end_sec: 2.175,
      source_start_sec: 0.3,
      source_range_duration_sec: 2.55,
      speed: 2,
      audio_fade_in_sec: 0.1, // matches transitionIn duration
      audio_fade_out_sec: 0.15, // matches transitionOut duration
    });
  });
});

describe('sanitizeNativeAudioSpeed', () => {
  it('matches native scene speed boundaries', () => {
    expect(sanitizeNativeAudioSpeed(undefined)).toBe(1);
    expect(sanitizeNativeAudioSpeed(0)).toBe(1);
    expect(sanitizeNativeAudioSpeed(0.005)).toBe(0.01);
    expect(sanitizeNativeAudioSpeed(150)).toBe(100);
    expect(sanitizeNativeAudioSpeed(-0.005)).toBe(-0.01);
    expect(sanitizeNativeAudioSpeed(-150)).toBe(-100);
  });
});
