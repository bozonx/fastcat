import { describe, expect, it } from 'vitest';

import {
  buildClipPlaybackWindow,
  getSourceTimeForClipLocal,
  isReversedClip,
} from '~/utils/video-editor/audio-playback-window';

import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

function createClip(overrides: Partial<AudioEngineClip> = {}): AudioEngineClip {
  return {
    id: 'clip-1',
    sourcePath: 'audio.mp3',
    fileHandle: {} as FileSystemFileHandle,
    startUs: 1_000_000,
    durationUs: 2_000_000,
    sourceStartUs: 5_000_000,
    sourceRangeDurationUs: 2_000_000,
    sourceDurationUs: 10_000_000,
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
        transitionIn: { durationUs: 500_000, mode: 'adjacent' },
        transitionOut: { durationUs: 250_000, mode: 'adjacent' },
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

  it('rejects reversed clips', () => {
    const clip = createClip({ speed: -1 });

    expect(isReversedClip(clip)).toBe(true);
    expect(
      buildClipPlaybackWindow({
        clip,
        currentTimeS: 1,
        speed: 1,
        startAtS: 0,
        adjacentClips: { previousClip: null, nextClip: null },
      }),
    ).toBeNull();
  });
});
