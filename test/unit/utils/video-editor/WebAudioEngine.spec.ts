/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebAudioEngine } from '~/utils/video-editor/WebAudioEngine';

vi.mock('~/utils/video-editor/AudioChunkDecoder', () => ({
  AudioChunkDecoder: vi.fn().mockImplementation(function () {
    return {
      prefetchHeadChunks: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
      destroy: vi.fn(),
      ensureDecoded: vi.fn().mockResolvedValue({
        buffer: { sampleRate: 48000, duration: 5, length: 240000, numberOfChannels: 2 },
        startTimeS: 0,
        durationS: 5,
      }),
      getChunkIndex: vi.fn().mockReturnValue(0),
      getForRange: vi.fn().mockResolvedValue([]),
      extractPeaks: vi.fn().mockResolvedValue([new Float32Array([0.5])]),
    };
  }),
}));

vi.mock('~/utils/video-editor/AudioGraphBuilder', () => ({
  AudioGraphBuilder: vi.fn().mockImplementation(function () {
    return {
      buildClipGraph: vi.fn().mockResolvedValue({ destroy: vi.fn().mockResolvedValue(undefined) }),
    };
  }),
}));

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
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn((arr: Float32Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = 0.5;
        }
      }),
    };
  }

  createBufferSource() {
    return {
      buffer: null as unknown as AudioBuffer,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as unknown as (() => void) | null,
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
    vi.clearAllMocks();
  });

  describe('capabilities', () => {
    it('reports all features enabled', () => {
      const engine = new WebAudioEngine();
      expect(engine.capabilities).toEqual({
        scrubPreview: true,
        peaksExtraction: true,
        levelMetering: true,
      });
    });
  });

  describe('volume', () => {
    it('setMasterVolume clamps and updates gain node', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.setMasterVolume(5);
      const masterGain = (engine as any).masterGain;
      expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(5, 0, 0.02);
    });

    it('setMonitorVolume updates monitor gain value', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.setMonitorVolume(3);
      expect((engine as any).monitorGain.gain.value).toBe(3);
    });
  });

  describe('getLevels', () => {
    it('returns silence when not playing', () => {
      const engine = new WebAudioEngine();
      expect(engine.getLevels()).toEqual({ rmsDb: -60, peakDb: -60 });
    });

    it('returns computed levels when playing', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      (engine as any).scheduler.play(0, 1);
      const levels = engine.getLevels();
      expect(levels.rmsDb).toBeGreaterThan(-10);
      expect(levels.peakDb).toBeGreaterThan(-10);
    });
  });

  describe('playback control', () => {
    it('play increments schedule generation', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const before = (engine as any).scheduleGeneration;
      await engine.play(0);
      expect((engine as any).scheduleGeneration).toBe(before + 1);
    });

    it('stop increments schedule generation', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const before = (engine as any).scheduleGeneration;
      engine.stop();
      expect((engine as any).scheduleGeneration).toBe(before + 1);
    });

    it('seek increments schedule generation', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const before = (engine as any).scheduleGeneration;
      engine.seek(1_000_000);
      expect((engine as any).scheduleGeneration).toBe(before + 1);
    });

    it('setGlobalSpeed increments schedule generation', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const before = (engine as any).scheduleGeneration;
      engine.setGlobalSpeed(2);
      expect((engine as any).scheduleGeneration).toBe(before + 1);
    });
  });

  describe('scrub preview', () => {
    it('stopScrubPreview clears active scrub nodes', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const node = {
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null as unknown as (() => void) | null,
      };
      (engine as any).activeScrubNodes.add(node);
      engine.stopScrubPreview();
      expect((engine as any).activeScrubNodes.size).toBe(0);
    });
  });

  describe('destroy', () => {
    it('closes context and clears state', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.destroy();
      expect((engine as any).destroyed).toBe(true);
      expect((engine as any).ctx).toBeNull();
    });

    it('is safe to call twice', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.destroy();
      engine.destroy();
      expect((engine as any).destroyed).toBe(true);
    });
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

      expect((engine as any).currentClips).toEqual(clips);
    });
  });
});
