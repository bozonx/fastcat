import { describe, expect, it } from 'vitest';

import {
  buildClipPlaybackWindow,
  getSourceTimeForClipLocal,
  hasPanAnimation,
  hasVolumeAnimation,
  resolveAnimatedBaseGain,
  resolveAnimatedPan,
} from '~/utils/video-editor/audio-playback-window';

import type { AudioEngineClip, ClipPlaybackWindow } from '~/utils/video-editor/audio-engine.types';

function createClip(overrides: Partial<AudioEngineClip> = {}): AudioEngineClip {
  return {
    id: 'clip-1',
    sourcePath: 'audio.mp3',
    fileHandle: {} as FileSystemFileHandle,
    startTicks: 254_016_000_000,
    durationTicks: 508_032_000_000,
    sourceStartTicks: 1_270_080_000_000,
    sourceRangeDurationTicks: 508_032_000_000,
    sourceDurationTicks: 2_540_160_000_000,
    ...overrides,
  };
}

describe('audio playback window', () => {
  it('builds a forward playback window and maps clip local time to source time', () => {
    const window = buildClipPlaybackWindow({
      clip: createClip({ speed: 2, audioGain: 0.5, audioBalance: -0.25 }),
      currentTimeS: 1.25,
      speed: 1.5,
      startAtS: 10,
      adjacentClips: { previousClip: null, nextClip: null },
    });

    expect(window).not.toBeNull();
    expect(window?.currentClipLocalS).toBeCloseTo(0.25);
    expect(window?.remainingInClipS).toBeCloseTo(1.75);
    expect(window?.clipSpeed).toBe(2);
    expect(window?.effectiveSpeed).toBe(3);
    expect(window?.audioGain).toBe(0.5);
    expect(window?.audioBalance).toBe(-0.25);
    expect(window ? getSourceTimeForClipLocal(window, 0.5) : 0).toBeCloseTo(6);
  });

  it('extends adjacent transition windows into source and timeline ranges', () => {
    const window = buildClipPlaybackWindow({
      clip: createClip({
        speed: 2,
        transitionIn: { durationTicks: 127_008_000_000, mode: 'adjacent' },
        transitionOut: { durationTicks: 63_504_000_000, mode: 'adjacent' },
      }),
      currentTimeS: 0.75,
      speed: 1,
      startAtS: 20,
      adjacentClips: { previousClip: null, nextClip: null },
    });

    expect(window).not.toBeNull();
    expect(window?.effectiveStartS).toBeCloseTo(0.5);
    expect(window?.effectiveSourceStartS).toBeCloseTo(4);
    expect(window?.remainingInClipS).toBeCloseTo(2.5);
    expect(window?.effectiveSourceEndS).toBeCloseTo(9.5);
  });

  it('carries keyframe tracks onto the window', () => {
    const window = buildClipPlaybackWindow({
      clip: createClip({
        animations: {
          'audio.volume': {
            keyframes: [
              { tTicks: 1_270_080_000_000, value: 1, easing: 'linear' },
              { tTicks: 1_778_112_000_000, value: 0, easing: 'linear' },
            ],
          },
        },
      }),
      currentTimeS: 1,
      speed: 1,
      startAtS: 0,
      adjacentClips: { previousClip: null, nextClip: null },
    });
    expect(window).not.toBeNull();
    expect(hasVolumeAnimation(window!)).toBe(true);
    expect(hasPanAnimation(window!)).toBe(false);
  });
});

function windowWith(overrides: Partial<ClipPlaybackWindow>): ClipPlaybackWindow {
  return {
    currentTimeS: 0,
    startAtS: 0,
    currentClipLocalS: 0,
    remainingInClipS: 2,
    effectiveStartS: 0,
    effectiveSourceStartS: 5, // source starts at 5s
    effectiveSourceEndS: 7,
    clipDurationS: 2,
    clipSpeed: 1,
    fadeInS: 0,
    fadeOutS: 0,
    fadeInCurve: 'linear',
    fadeOutCurve: 'linear',
    audioGain: 0.5,
    audioBalance: -0.25,
    effectiveSpeed: 1,
    globalSpeed: 1,
    ...overrides,
  };
}

describe('resolveAnimatedBaseGain', () => {
  it('falls back to the static gain when unanimated', () => {
    const window = windowWith({});
    expect(resolveAnimatedBaseGain(window, 0)).toBe(0.5);
    expect(resolveAnimatedBaseGain(window, 1)).toBe(0.5);
  });

  it('samples the volume track at the source-relative time', () => {
    // Source runs 5s..7s; keyframes 1 -> 0 over that span. Clip-local 0 -> source 5s
    // -> value 1; clip-local 1 -> source 6s -> value 0.5; clip-local 2 -> 0.
    const window = windowWith({
      animations: {
        'audio.volume': {
          keyframes: [
            { tTicks: 1_270_080_000_000, value: 1, easing: 'linear' },
            { tTicks: 1_778_112_000_000, value: 0, easing: 'linear' },
          ],
        },
      },
    });
    expect(resolveAnimatedBaseGain(window, 0)).toBeCloseTo(1);
    expect(resolveAnimatedBaseGain(window, 1)).toBeCloseTo(0.5);
    expect(resolveAnimatedBaseGain(window, 2)).toBeCloseTo(0);
  });
});

describe('resolveAnimatedPan', () => {
  it('falls back to the static balance when unanimated', () => {
    expect(resolveAnimatedPan(windowWith({}), 1)).toBe(-0.25);
  });

  it('samples and clamps the pan track', () => {
    const window = windowWith({
      animations: {
        'audio.pan': {
          keyframes: [
            { tTicks: 1_270_080_000_000, value: -1, easing: 'linear' },
            { tTicks: 1_778_112_000_000, value: 1, easing: 'linear' },
          ],
        },
      },
    });
    expect(resolveAnimatedPan(window, 0)).toBeCloseTo(-1);
    expect(resolveAnimatedPan(window, 1)).toBeCloseTo(0);
    expect(resolveAnimatedPan(window, 2)).toBeCloseTo(1);
  });
});
