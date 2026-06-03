/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebAudioEngine } from '~/utils/video-editor/WebAudioEngine';

class FakeAudioBuffer {
  sampleRate = 48000;
  length = 48000;
  duration = 1;
  numberOfChannels = 2;
}

class FakeAudioContext {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  destination = {
    channelCount: 2,
    channelCountMode: 'explicit',
  } as unknown as AudioDestinationNode;

  createGain() {
    return {
      gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn(),
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

describe('WebAudioEngine', () => {
  let originalAudioContext: typeof globalThis.AudioContext | undefined;

  beforeEach(() => {
    originalAudioContext = (globalThis as any).AudioContext;
    (globalThis as any).AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    (globalThis as any).AudioContext = originalAudioContext;
  });

  describe('updateTimelineLayout', () => {
    it('returns a Promise<void>', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const result = engine.updateTimelineLayout([]);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('updates currentClips and resolves', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const clips = [
        {
          id: 'audio-1',
          sourcePath: '/audio/test.mp3',
          fileHandle: null as unknown as FileSystemFileHandle,
          startUs: 0,
          durationUs: 1_000_000,
          sourceStartUs: 0,
          sourceRangeDurationUs: 1_000_000,
          sourceDurationUs: 1_000_000,
          speed: 1,
          audioGain: 1,
          audioBalance: 0,
          audioEffects: [] as import('~/utils/video-editor/audio-engine.types').AudioEffect[],
        },
      ];

      await engine.updateTimelineLayout(clips);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((engine as any).currentClips).toEqual(clips);
    });
  });
});
