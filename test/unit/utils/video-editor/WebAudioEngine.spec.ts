/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebAudioEngine } from '~/utils/video-editor/WebAudioEngine';
import { runAudioEngineContract } from './audio-engine-contract';

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

  // Cross-engine behaviour shared with TauriAudioEngine (transport clock, idle
  // metering silence, capability-gated peaks, tolerant setters).
  runAudioEngineContract('WebAudioEngine', {
    createEngine: async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      return engine;
    },
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
      engine.setMasterVolume(2);
      const masterGain = (engine as any).masterGain;
      expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(2, 0, 0.02);
    });

    it('setMonitorVolume uses setTargetAtTime for smooth transition', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.setMonitorVolume(0.5);
      const monitorGain = (engine as any).monitorGain;
      expect(monitorGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 0, 0.02);
    });

    it('setMonitorVolume clamps out-of-range values', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      engine.setMonitorVolume(999);
      const monitorGain = (engine as any).monitorGain;
      // clampGain limits user-facing monitor volume to [0, 2].
      const calledValue = monitorGain.gain.setTargetAtTime.mock.calls[0][0];
      expect(calledValue).toBe(2);
    });
  });

  describe('initialization', () => {
    it('waits for the previous context to close before changing sample rate', async () => {
      let resolveClose: (() => void) | undefined;
      const closePromise = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
      const contexts: ControlledAudioContext[] = [];

      class ControlledAudioContext extends FakeAudioContext {
        override close = vi.fn(() => (contexts[0] === this ? closePromise : Promise.resolve()));

        constructor(options?: AudioContextOptions) {
          super();
          this.sampleRate = options?.sampleRate ?? 48_000;
          contexts.push(this);
        }
      }

      vi.stubGlobal('AudioContext', ControlledAudioContext);
      const engine = new WebAudioEngine();
      await engine.init({ sampleRate: 48_000 });

      const reinitialize = engine.init({ sampleRate: 44_100 });
      await Promise.resolve();

      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.close).toHaveBeenCalledTimes(1);

      resolveClose?.();
      await reinitialize;

      expect(contexts).toHaveLength(2);
      expect(contexts[1]?.sampleRate).toBe(44_100);
    });
  });

  describe('getLevels', () => {
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
    // The transport-clock behaviour of play/stop/seek/setGlobalSpeed is asserted
    // by the shared IAudioEngine contract above. These cover only Web-specific
    // bookkeeping that the contract cannot observe.
    it('play bumps the schedule generation so stale decodes are dropped', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const before = (engine as any).scheduleGeneration;
      await engine.play(0);
      expect((engine as any).scheduleGeneration).toBe(before + 1);
    });

    it('uses the latest speed when playback preparation resolves', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      let finishPreparation: (() => void) | undefined;
      const preparation = new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      vi.spyOn(engine as any, 'prepareForPlayback').mockReturnValue(preparation);
      const schedulerPlay = vi
        .spyOn((engine as any).scheduler, 'play')
        .mockResolvedValue(undefined);

      const play = engine.play(0, 1);
      engine.setGlobalSpeed(0.5);
      engine.setGlobalSpeed(0.75);
      finishPreparation?.();
      await play;

      expect(schedulerPlay).toHaveBeenCalledWith(0, 0.75);
    });

    it('cancels a pending playback request when stopped during preparation', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      let finishPreparation: (() => void) | undefined;
      const preparation = new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      vi.spyOn(engine as any, 'prepareForPlayback').mockReturnValue(preparation);
      const schedulerPlay = vi
        .spyOn((engine as any).scheduler, 'play')
        .mockResolvedValue(undefined);

      const play = engine.play(0, 1);
      engine.stop();
      finishPreparation?.();
      await play;

      expect(schedulerPlay).not.toHaveBeenCalled();
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

    it('does not block layout updates on background audio prefetch', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const decoder = (engine as any).chunkDecoder;
      decoder.prefetchHeadChunks.mockReturnValue(new Promise(() => {}));

      await expect(engine.updateTimelineLayout([])).resolves.toBeUndefined();
      expect(decoder.prefetchHeadChunks).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          maxClips: 8,
          concurrency: 1,
        }),
      );
    });

    it('stops scrub preview on layout update', async () => {
      const engine = new WebAudioEngine();
      await engine.init();
      const stopScrubSpy = vi.spyOn(engine, 'stopScrubPreview');
      await engine.updateTimelineLayout([]);
      expect(stopScrubSpy).toHaveBeenCalled();
    });
  });

  describe('setMasterAudioEffects', () => {
    it('triggers rebuild when effect parameters change (deep comparison)', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const effectsV1 = [
        { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', wet: 0.5 },
      ];
      engine.setMasterAudioEffects(effectsV1 as any);

      // Wait for async graph build
      await new Promise((resolve) => setTimeout(resolve, 10));

      const effectsV2 = [
        { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', wet: 0.8 },
      ];
      const beforeGen = (engine as any).masterEffectGeneration;
      engine.setMasterAudioEffects(effectsV2 as any);

      // Generation should bump — parameter changed even though id/type/enabled are the same
      expect((engine as any).masterEffectGeneration).toBe(beforeGen + 1);
    });

    it('does not rebuild when effects are deeply equal', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const effects = [
        { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', wet: 0.5 },
      ];
      engine.setMasterAudioEffects(effects as any);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const beforeGen = (engine as any).masterEffectGeneration;
      engine.setMasterAudioEffects([...effects] as any);

      expect((engine as any).masterEffectGeneration).toBe(beforeGen);
    });

    it('does not rebuild when key order differs but values match', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const effects = [
        { id: 'fx1', type: 'audio-reverb', enabled: true, target: 'audio', wet: 0.5 },
      ];
      engine.setMasterAudioEffects(effects as any);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Same values, different key order — deepEqualEffects should handle this
      const reordered = [
        { wet: 0.5, target: 'audio', enabled: true, type: 'audio-reverb', id: 'fx1' },
      ];
      const beforeGen = (engine as any).masterEffectGeneration;
      engine.setMasterAudioEffects(reordered as any);

      expect((engine as any).masterEffectGeneration).toBe(beforeGen);
    });

    it('rebuilds when nested parameter changes', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const effectsV1 = [
        {
          id: 'fx1',
          type: 'audio-reverb',
          enabled: true,
          target: 'audio',
          wet: 0.5,
          params: { decay: 2, damping: 0.5 },
        },
      ];
      engine.setMasterAudioEffects(effectsV1 as any);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const effectsV2 = [
        {
          id: 'fx1',
          type: 'audio-reverb',
          enabled: true,
          target: 'audio',
          wet: 0.5,
          params: { decay: 3, damping: 0.5 },
        },
      ];
      const beforeGen = (engine as any).masterEffectGeneration;
      engine.setMasterAudioEffects(effectsV2 as any);

      expect((engine as any).masterEffectGeneration).toBe(beforeGen + 1);
    });
  });

  describe('trackClipsCache', () => {
    it('invalidates cache on updateTimelineLayout', async () => {
      const engine = new WebAudioEngine();
      await engine.init();

      const clips = [
        {
          id: 'c1',
          sourcePath: '/a.mp3',
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
          trackId: 'track-1',
        },
      ];

      await engine.updateTimelineLayout(clips);
      // Access the cache to populate it
      (engine as any).getTrackClipsCache();
      expect((engine as any).trackClipsCache).not.toBeNull();

      // Update with new clips — cache should be invalidated
      await engine.updateTimelineLayout([]);
      expect((engine as any).trackClipsCache).toBeNull();
    });
  });
});
