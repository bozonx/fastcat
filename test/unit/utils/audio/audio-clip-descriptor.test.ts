import { describe, expect, it } from 'vitest';
import type { WorkerTimelineClip } from '~/types/worker-payload';
import {
  buildCanonicalAudioClipDescriptor,
  sanitizeNativeAudioSpeed,
  toAudioEngineClip,
  toNativeSceneAudioLayer,
} from '~/utils/audio/audio-clip-descriptor';
import { buildClipPlaybackWindow } from '~/utils/video-editor/audio-playback-window';

interface AudioWorkerClip extends WorkerTimelineClip {
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
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

    // Gain is split (layer = clip-only 0.5, bus re-applies track gain), but
    // balance carries the merged (track+clip) value so the native single pan
    // matches the web StereoPanner instead of cascading two pans.
    expect(nativeLayer.audio_gain).toBe(0.5);
    expect(nativeLayer.audio_balance).toBe(-0.25);
    expect(webClip.audioBalance).toBe(nativeLayer.audio_balance);
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

  it('uses clip-only gain (bus re-applies track gain) and merged balance (single pan)', () => {
    const descriptor = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        audioGain: 0.5, // merged track * clip gain
        audioBalance: -0.5, // merged track + clip balance
        originalAudioGain: 1.0, // clip-only gain
        originalAudioBalance: 0.0, // clip-only balance
      }),
      sourcePath: '/project/audio/source.mp3',
    });
    const nativeLayer = toNativeSceneAudioLayer({ descriptor });

    // Gain: the native bus re-applies the track gain, so the layer carries the
    // clip-only value (layer×bus = merged). Balance: the bus pan is neutralized
    // (native-monitor-scene.ts), so the layer must carry the MERGED balance for a
    // single additive pan matching the web StereoPanner.
    expect(nativeLayer.audio_gain).toBe(1.0);
    expect(nativeLayer.audio_balance).toBe(-0.5);
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
        timelineRange: { startUs: 1_000_000, durationUs: 875_000 },
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
      // Own transitionIn (0.1s) shifts the clip back onto its leading handle and
      // own transitionOut (0.15s) extends its trailing handle — both keyed off
      // the clip's OWN transition, mirroring the web engine + export mixer so the
      // incoming side of a transition crossfades over the same window everywhere.
      // start: 1.0 - 0.1 = 0.9; source_start: 0.5 - 0.1*2 = 0.3.
      timeline_start_sec: 0.9,
      timeline_end_sec: 2.025,
      source_start_sec: 0.3,
      source_range_duration_sec: 2.25,
      speed: 2,
      audio_fade_in_sec: 0.1, // matches transitionIn duration
      audio_fade_out_sec: 0.15, // matches transitionOut duration
    });

    const webClip = toAudioEngineClip({
      descriptor,
      fileHandle: {} as FileSystemFileHandle,
    });
    const webWindow = buildClipPlaybackWindow({
      clip: webClip,
      currentTimeS: nativeLayer.timeline_start_sec,
      speed: 1,
      startAtS: 0,
      adjacentClips: { previousClip: null, nextClip: null },
    });

    expect(webWindow).not.toBeNull();
    expect(nativeLayer.timeline_start_sec).toBeCloseTo(webWindow?.effectiveStartS ?? 0);
    expect(nativeLayer.timeline_end_sec - nativeLayer.timeline_start_sec).toBeCloseTo(
      webWindow?.remainingInClipS ?? 0,
    );
    expect(nativeLayer.source_start_sec).toBeCloseTo(webWindow?.effectiveSourceStartS ?? 0);
    expect(nativeLayer.source_range_duration_sec).toBeCloseTo(
      (webWindow?.effectiveSourceEndS ?? 0) - (webWindow?.effectiveSourceStartS ?? 0),
    );
  });

  it('keeps adjacent crossfade settings identical for web monitor and native monitor/export', () => {
    const outgoing = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        id: 'outgoing',
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        sourceDurationUs: 3_000_000,
        speed: 1,
        audioFadeInUs: undefined,
        audioFadeOutUs: undefined,
        audioFadeOutCurve: 'logarithmic',
        audioDeclickDurationUs: undefined,
        transitionIn: undefined,
        transitionOut: { type: 'dissolve', durationUs: 500_000, mode: 'adjacent' },
      }),
      sourcePath: '/project/audio/outgoing.wav',
    });
    const incoming = buildCanonicalAudioClipDescriptor({
      clip: createClip({
        id: 'incoming',
        timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
        sourceRange: { startUs: 500_000, durationUs: 1_000_000 },
        sourceDurationUs: 3_000_000,
        speed: 1,
        audioFadeInUs: undefined,
        audioFadeOutUs: undefined,
        audioDeclickDurationUs: undefined,
        transitionIn: undefined,
        transitionOut: undefined,
      }),
      sourcePath: '/project/audio/incoming.wav',
    });

    const outgoingNative = toNativeSceneAudioLayer({ descriptor: outgoing, next: incoming });
    const incomingNative = toNativeSceneAudioLayer({ descriptor: incoming, previous: outgoing });
    const outgoingWeb = toAudioEngineClip({
      descriptor: outgoing,
      fileHandle: {} as FileSystemFileHandle,
    });
    const incomingWeb = toAudioEngineClip({
      descriptor: incoming,
      fileHandle: {} as FileSystemFileHandle,
    });

    const outgoingWindow = buildClipPlaybackWindow({
      clip: outgoingWeb,
      currentTimeS: 0,
      speed: 1,
      startAtS: 0,
      adjacentClips: { previousClip: null, nextClip: incomingWeb },
    });
    const incomingWindow = buildClipPlaybackWindow({
      clip: incomingWeb,
      currentTimeS: 0.5,
      speed: 1,
      startAtS: 0,
      adjacentClips: { previousClip: outgoingWeb, nextClip: null },
    });

    expect(outgoingNative.timeline_start_sec).toBeCloseTo(outgoingWindow?.effectiveStartS ?? -1);
    expect(outgoingNative.timeline_end_sec).toBeCloseTo(1.5);
    expect(outgoingNative.audio_fade_out_sec).toBeCloseTo(outgoingWindow?.fadeOutS ?? -1);
    expect(outgoingNative.audio_fade_out_curve).toBe(outgoingWindow?.fadeOutCurve);

    expect(incomingNative.timeline_start_sec).toBeCloseTo(incomingWindow?.effectiveStartS ?? -1);
    expect(incomingNative.timeline_end_sec).toBeCloseTo(2);
    expect(incomingNative.source_start_sec).toBeCloseTo(
      incomingWindow?.effectiveSourceStartS ?? -1,
    );
    expect(incomingNative.audio_fade_in_sec).toBeCloseTo(incomingWindow?.fadeInS ?? -1);
    expect(incomingNative.audio_fade_in_curve).toBe(incomingWindow?.fadeInCurve);

    expect(outgoingNative.timeline_end_sec).toBeGreaterThan(incomingNative.timeline_start_sec);
    expect(outgoingNative.timeline_end_sec - incomingNative.timeline_start_sec).toBeCloseTo(0.5);
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
