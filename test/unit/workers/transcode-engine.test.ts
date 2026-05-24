// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  createReversedAudioSamples,
  createAudioProcessConfig,
  ensureNotCancelled,
  notifyPhase,
} from '~/workers/core/transcode-engine';
import type { ExportOptions } from '~/composables/timeline/export/types';

function createMockAudioSample(): new (...args: any[]) => unknown {
  return function (this: Record<string, unknown>, params: Record<string, unknown>) {
    Object.assign(this, params);
  } as unknown as new (...args: any[]) => unknown;
}

describe('createReversedAudioSamples', () => {
  it('returns empty array for empty input', () => {
    const AudioSample = createMockAudioSample();
    expect(createReversedAudioSamples(AudioSample, [])).toEqual([]);
  });

  it('reverses a single sample', () => {
    const AudioSample = createMockAudioSample();
    const samples = [
      {
        data: new Float32Array([1, 2, 3, 4]),
        frameCount: 2,
        numberOfChannels: 2,
        sampleRate: 48000,
      },
    ];

    const result = createReversedAudioSamples(AudioSample, samples);
    expect(result).toHaveLength(1);
    const created = result[0] as { data: Float32Array };
    expect(created.data[0]).toBe(3);
    expect(created.data[1]).toBe(4);
    expect(created.data[2]).toBe(1);
    expect(created.data[3]).toBe(2);
  });

  it('reverses multiple samples preserving chunk boundaries', () => {
    const AudioSample = createMockAudioSample();
    const samples = [
      {
        data: new Float32Array([1, 2]),
        frameCount: 1,
        numberOfChannels: 2,
        sampleRate: 48000,
      },
      {
        data: new Float32Array([3, 4]),
        frameCount: 1,
        numberOfChannels: 2,
        sampleRate: 48000,
      },
    ];

    const result = createReversedAudioSamples(AudioSample, samples);
    expect(result).toHaveLength(2);
  });
});

describe('createAudioProcessConfig', () => {
  it('returns empty object when audioReverse is false', () => {
    const options = {
      audioReverse: false,
      videoCodec: 'none',
      audioDurationSec: 10,
    } as unknown as ExportOptions;

    const config = createAudioProcessConfig(options, createMockAudioSample());
    expect(config).toEqual({});
  });

  it('returns empty object when videoCodec is not none', () => {
    const options = {
      audioReverse: true,
      videoCodec: 'h264',
      audioDurationSec: 10,
    } as unknown as ExportOptions;

    const config = createAudioProcessConfig(options, createMockAudioSample());
    expect(config).toEqual({});
  });

  it('buffers samples and emits reversed on last sample', () => {
    const AudioSample = createMockAudioSample();
    const options = {
      audioReverse: true,
      videoCodec: 'none',
      audioDurationSec: 2,
    } as unknown as ExportOptions;

    const config = createAudioProcessConfig(options, AudioSample);
    expect('process' in config).toBe(true);
    const processFn = (config as { process: (sample: unknown) => unknown }).process;

    const sample1 = {
      timestamp: 0,
      duration: 1,
      numberOfFrames: 48000,
      numberOfChannels: 2,
      sampleRate: 48000,
      allocationSize: () => 48000 * 2 * 4,
      copyTo: (dst: Float32Array) => {
        dst.fill(0.5);
      },
    };

    const sample2 = {
      timestamp: 1,
      duration: 1,
      numberOfFrames: 48000,
      numberOfChannels: 2,
      sampleRate: 48000,
      allocationSize: () => 48000 * 2 * 4,
      copyTo: (dst: Float32Array) => {
        dst.fill(0.8);
      },
    };

    // First sample should not emit
    const result1 = processFn(sample1);
    expect(result1).toBeNull();

    // Last sample should emit reversed array
    const result2 = processFn(sample2);
    expect(result2).toBeInstanceOf(Array);
    expect((result2 as unknown[]).length).toBeGreaterThan(0);
  });

  it('emits only once', () => {
    const AudioSample = createMockAudioSample();
    const options = {
      audioReverse: true,
      videoCodec: 'none',
      audioDurationSec: 1,
    } as unknown as ExportOptions;

    const config = createAudioProcessConfig(options, AudioSample);
    const processFn = (config as { process: (sample: unknown) => unknown }).process;

    const sample = {
      timestamp: 0,
      duration: 2,
      numberOfFrames: 96000,
      numberOfChannels: 1,
      sampleRate: 48000,
      allocationSize: () => 96000 * 4,
      copyTo: (dst: Float32Array) => {
        dst.fill(0.5);
      },
    };

    const result1 = processFn(sample);
    expect(result1).toBeInstanceOf(Array);

    const result2 = processFn(sample);
    expect(result2).toBeNull();
  });
});

describe('ensureNotCancelled', () => {
  it('does nothing when not cancelled', () => {
    expect(() => ensureNotCancelled(() => false)).not.toThrow();
  });

  it('throws AbortError when cancelled', () => {
    expect(() => ensureNotCancelled(() => true)).toThrow('Export was cancelled');
    try {
      ensureNotCancelled(() => true);
    } catch (err) {
      expect((err as Error).name).toBe('AbortError');
    }
  });
});

describe('notifyPhase', () => {
  it('does nothing when hostClient is null', async () => {
    await expect(notifyPhase(null, 'encoding')).resolves.toBeUndefined();
  });

  it('calls onExportPhase on hostClient', async () => {
    const hostClient = {
      onExportPhase: vi.fn().mockResolvedValue(undefined),
    };
    await notifyPhase(
      hostClient as unknown as { onExportPhase: (phase: string, taskId?: string) => Promise<void> },
      'encoding',
      'task-1',
    );
    expect(hostClient.onExportPhase).toHaveBeenCalledWith('encoding', 'task-1');
  });

  it('swallows errors from hostClient', async () => {
    const hostClient = {
      onExportPhase: vi.fn().mockRejectedValue(new Error('network error')),
    };
    await expect(
      notifyPhase(
        hostClient as unknown as {
          onExportPhase: (phase: string, taskId?: string) => Promise<void>;
        },
        'saving',
      ),
    ).resolves.toBeUndefined();
  });
});
