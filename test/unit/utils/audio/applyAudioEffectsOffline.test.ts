import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyAudioEffects, applyAudioEffectsOffline } from '~/utils/audio/applyAudioEffectsOffline';
import { buildAudioEffectGraph } from '~/utils/audio/effectGraph';

vi.mock('~/utils/audio/effectGraph', () => ({
  buildAudioEffectGraph: vi.fn(),
}));

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  _data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel: number) {
    return this._data[channel];
  }

  copyToChannel(source: Float32Array, channel: number, startInChannel: number) {
    this._data[channel].set(source, startInChannel);
  }
}

class MockOfflineAudioContext {
  channels: number;
  length: number;
  sampleRate: number;
  destination: any;

  constructor(channels: number, length: number, sampleRate: number) {
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.destination = {};
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    return {
      buffer: null,
      start: vi.fn(),
    };
  }

  async startRendering() {
    const rendered = new MockAudioBuffer(this.channels, this.length, this.sampleRate);
    // Fill with some mock processed data
    for (let c = 0; c < this.channels; c++) {
      rendered.getChannelData(c).fill(0.5);
    }
    return rendered;
  }
}

describe('applyAudioEffectsOffline', () => {
  let originalOfflineCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalOfflineCtx = globalThis.OfflineAudioContext;
    (globalThis as any).OfflineAudioContext = MockOfflineAudioContext;

    vi.mocked(buildAudioEffectGraph).mockReturnValue({
      outputNode: { connect: vi.fn() },
      destroy: vi.fn(),
    } as any);
  });

  afterEach(() => {
    (globalThis as any).OfflineAudioContext = originalOfflineCtx;
  });

  describe('applyAudioEffects', () => {
    it('returns original buffer if no enabled effects', async () => {
      const buffer = new MockAudioBuffer(2, 44100, 44100) as unknown as AudioBuffer;
      const result = await applyAudioEffects({
        buffer,
        effects: [{ id: '1', type: 'eq', enabled: false, target: 'audio' }],
      });

      expect(result).toBe(buffer);
    });

    it('returns original buffer if buffer duration is 0', async () => {
      const buffer = new MockAudioBuffer(2, 0, 44100) as unknown as AudioBuffer;
      const result = await applyAudioEffects({
        buffer,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result).toBe(buffer);
    });

    it('returns original buffer if target is not audio', async () => {
      const buffer = new MockAudioBuffer(2, 44100, 44100) as unknown as AudioBuffer;
      const result = await applyAudioEffects({
        buffer,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'video' }],
      });

      expect(result).toBe(buffer);
    });

    it('applies effects and returns new buffer', async () => {
      const buffer = new MockAudioBuffer(2, 44100, 44100);
      buffer.getChannelData(0).fill(0.1);
      buffer.getChannelData(1).fill(0.2);

      const result = await applyAudioEffects({
        buffer: buffer as unknown as AudioBuffer,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result).not.toBe(buffer);
      // Our mock sets output to 0.5
      expect(result.getChannelData(0)[0]).toBe(0.5);
      expect(result.getChannelData(1)[0]).toBe(0.5);
      expect(buildAudioEffectGraph).toHaveBeenCalled();
    });

    it('returns original buffer on error', async () => {
      const buffer = new MockAudioBuffer(2, 44100, 44100) as unknown as AudioBuffer;
      vi.mocked(buildAudioEffectGraph).mockImplementation(() => {
        throw new Error('Graph error');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await applyAudioEffects({
        buffer,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result).toBe(buffer);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[applyAudioEffects] Failed to apply effects, using raw audio',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('applyAudioEffectsOffline (raw planes)', () => {
    it('returns original planes if no enabled effects', async () => {
      const planes = [new Float32Array(10), new Float32Array(10)];
      const result = await applyAudioEffectsOffline({
        planes,
        sampleRate: 44100,
        frames: 10,
        channels: 2,
        effects: [{ id: '1', type: 'eq', enabled: false, target: 'audio' }],
      });

      expect(result.planes).toBe(planes);
      expect(result.frames).toBe(10);
    });

    it('returns original planes if frames is 0', async () => {
      const planes = [new Float32Array(0), new Float32Array(0)];
      const result = await applyAudioEffectsOffline({
        planes,
        sampleRate: 44100,
        frames: 0,
        channels: 2,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result.planes).toBe(planes);
      expect(result.frames).toBe(0);
    });

    it('applies effects and returns new planes', async () => {
      const planes = [new Float32Array(10).fill(0.1), new Float32Array(10).fill(0.2)];
      const result = await applyAudioEffectsOffline({
        planes,
        sampleRate: 44100,
        frames: 10,
        channels: 2,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result.planes).not.toBe(planes);
      expect(result.planes[0][0]).toBe(0.5); // from mock
      expect(result.planes[1][0]).toBe(0.5);
      expect(result.frames).toBe(10);
      expect(buildAudioEffectGraph).toHaveBeenCalled();
    });

    it('returns original planes on error', async () => {
      const planes = [new Float32Array(10)];
      vi.mocked(buildAudioEffectGraph).mockImplementation(() => {
        throw new Error('Graph error');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await applyAudioEffectsOffline({
        planes,
        sampleRate: 44100,
        frames: 10,
        channels: 1,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result.planes).toBe(planes);
      expect(result.frames).toBe(10);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[applyAudioEffectsOffline] Failed to apply effects, using raw audio',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('returns original planes if OfflineAudioContext is missing', async () => {
      (globalThis as any).OfflineAudioContext = undefined;
      const planes = [new Float32Array(10)];

      const result = await applyAudioEffectsOffline({
        planes,
        sampleRate: 44100,
        frames: 10,
        channels: 1,
        effects: [{ id: '1', type: 'eq', enabled: true, target: 'audio' }],
      });

      expect(result.planes).toBe(planes);
    });
  });
});
