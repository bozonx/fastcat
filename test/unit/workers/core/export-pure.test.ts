/** @vitest-environment node */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  isOpusCodec,
  buildMetadataTags,
  selectOutputFormat,
  isPassthroughCompatibleClip,
  createCoalescedExportProgressReporter,
  createExportWriterProgressAggregator,
  isVideoEncoderConfigSupported,
  waitForVideoBackpressure,
} from '~/workers/core/export';
import type { OutputFormatConstructors } from '~/workers/core/export';
import { timelineUs } from '../../utils/timeline-time';

function makeCtors(): OutputFormatConstructors {
  return {
    Mp4OutputFormat: class MockMp4 {},
    WebMOutputFormat: class MockWebM {},
    MkvOutputFormat: class MockMkv {},
    AdtsOutputFormat: class MockAdts {},
    OggOutputFormat: class MockOgg {},
    FlacOutputFormat: class MockFlac {},
    WavOutputFormat: class MockWav {},
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder;
});

describe('isOpusCodec', () => {
  it('returns true for "opus" codec string', () => {
    expect(isOpusCodec('opus')).toBe(true);
  });

  it('returns true for "Opus" case-insensitive', () => {
    expect(isOpusCodec('Opus')).toBe(true);
  });

  it('returns true for "opus_v1" prefix match', () => {
    expect(isOpusCodec('opus_v1')).toBe(true);
  });

  it('returns false for "mp4a" codec', () => {
    expect(isOpusCodec('mp4a.40.2')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isOpusCodec(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isOpusCodec('')).toBe(false);
  });
});

describe('buildMetadataTags', () => {
  it('returns null when all fields are empty', () => {
    expect(buildMetadataTags({})).toBeNull();
  });

  it('returns null when all fields are whitespace-only', () => {
    expect(buildMetadataTags({ title: '  ', description: '\t' })).toBeNull();
  });

  it('maps title to tags.title', () => {
    const tags = buildMetadataTags({ title: 'My Video' });
    expect(tags).toEqual({ title: 'My Video' });
  });

  it('maps description to tags.description', () => {
    const tags = buildMetadataTags({ description: 'A test video' });
    expect(tags).toEqual({ description: 'A test video' });
  });

  it('maps author to tags.artist (not tags.author)', () => {
    const tags = buildMetadataTags({ author: 'John Doe' });
    expect(tags).toEqual({ artist: 'John Doe' });
    expect(tags).not.toHaveProperty('author');
  });

  it('maps tags string to tags.comment as comma-separated', () => {
    const tags = buildMetadataTags({ tags: 'travel, nature, sunset' });
    expect(tags).toEqual({ comment: 'travel, nature, sunset' });
  });

  it('trims whitespace from all fields', () => {
    const tags = buildMetadataTags({
      title: '  Hello  ',
      description: '  World  ',
      author: '  Author  ',
      tags: '  a, b, c  ',
    });
    expect(tags).toEqual({
      title: 'Hello',
      description: 'World',
      artist: 'Author',
      comment: 'a, b, c',
    });
  });

  it('filters out empty tag entries from comma-separated list', () => {
    const tags = buildMetadataTags({ tags: 'a, , b,  , c' });
    expect(tags).toEqual({ comment: 'a, b, c' });
  });

  it('returns null when tags string has only empty entries', () => {
    const tags = buildMetadataTags({ tags: '  ,  ,  ' });
    expect(tags).toBeNull();
  });

  it('combines all fields together', () => {
    const tags = buildMetadataTags({
      title: 'Title',
      description: 'Desc',
      author: 'Auth',
      tags: 't1, t2',
    });
    expect(tags).toEqual({
      title: 'Title',
      description: 'Desc',
      artist: 'Auth',
      comment: 't1, t2',
    });
  });
});

describe('selectOutputFormat', () => {
  it('returns WebMOutputFormat for "webm"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('webm', ctors);
    expect(result).toBeInstanceOf(ctors.WebMOutputFormat);
  });

  it('returns MkvOutputFormat for "mkv"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('mkv', ctors);
    expect(result).toBeInstanceOf(ctors.MkvOutputFormat);
  });

  it('returns AdtsOutputFormat for "aac"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('aac', ctors);
    expect(result).toBeInstanceOf(ctors.AdtsOutputFormat);
  });

  it('returns OggOutputFormat for "opus"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('opus', ctors);
    expect(result).toBeInstanceOf(ctors.OggOutputFormat);
  });

  it('returns OggOutputFormat for "ogg"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('ogg', ctors);
    expect(result).toBeInstanceOf(ctors.OggOutputFormat);
  });

  it('returns FlacOutputFormat for "flac"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('flac', ctors);
    expect(result).toBeInstanceOf(ctors.FlacOutputFormat);
  });

  it('returns WavOutputFormat for "wav"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('wav', ctors);
    expect(result).toBeInstanceOf(ctors.WavOutputFormat);
  });

  it('returns WavOutputFormat for "pcm"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('pcm', ctors);
    expect(result).toBeInstanceOf(ctors.WavOutputFormat);
  });

  it('throws for "mp3" (not supported in web version)', () => {
    const ctors = makeCtors();
    expect(() => selectOutputFormat('mp3', ctors)).toThrow(
      'MP3 export is not supported in the web version',
    );
  });

  it('returns Mp4OutputFormat as default for "mp4"', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('mp4', ctors);
    expect(result).toBeInstanceOf(ctors.Mp4OutputFormat);
  });

  it('returns Mp4OutputFormat as default for unknown format', () => {
    const ctors = makeCtors();
    const result = selectOutputFormat('unknown', ctors);
    expect(result).toBeInstanceOf(ctors.Mp4OutputFormat);
  });
});

describe('isPassthroughCompatibleClip - extended edge cases', () => {
  const baseOpts = { audioSampleRate: 48000, audioChannels: 'stereo' as const };

  it('rejects clip with audio transition in', () => {
    const clip = {
      transitionIn: { durationUs: timelineUs(500_000) },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('transition');
    }
  });

  it('rejects clip with audio transition out', () => {
    const clip = {
      transitionOut: { durationUs: timelineUs(500_000) },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('transition');
    }
  });

  it('rejects clip with enabled audio effect', () => {
    const clip = {
      effects: [{ target: 'audio', enabled: true }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('audio effects');
    }
  });

  it('allows clip with disabled audio effect', () => {
    const clip = {
      effects: [{ target: 'audio', enabled: false }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('allows clip with video-only effect', () => {
    const clip = {
      effects: [{ target: 'video', enabled: true }],
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('rejects clip with negative speed (reverse)', () => {
    const clip = { speed: -1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('speed');
    }
  });

  it('allows clip with speed exactly 1', () => {
    const clip = { speed: 1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });

  it('rejects clip with gain slightly above 1', () => {
    const clip = { audioGain: 1.001 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('gain');
    }
  });

  it('rejects clip with non-zero balance', () => {
    const clip = { audioBalance: 0.1 };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('balance');
    }
  });

  it('rejects clip with fade in', () => {
    const clip = { audioFadeInUs: timelineUs(100_000) };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('fade');
    }
  });

  it('rejects clip with fade out', () => {
    const clip = { audioFadeOutUs: timelineUs(100_000) };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('fade');
    }
  });

  it('reads from fastcat nested object when top-level is absent', () => {
    const clip = {
      fastcat: { audioGain: 2.0 },
    };
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('gain');
    }
  });

  it('allows an empty clip (all defaults)', () => {
    const clip = {};
    const result = isPassthroughCompatibleClip(clip, baseOpts);
    expect(result.ok).toBe(true);
  });
});

describe('waitForVideoBackpressure', () => {
  it('waits with short adaptive delays while the encode queue is full', async () => {
    vi.useFakeTimers();
    const videoSource = { encodeQueueSize: 4 };
    const waitPromise = waitForVideoBackpressure(videoSource, 4);

    await vi.advanceTimersByTimeAsync(1);
    expect(videoSource.encodeQueueSize).toBe(4);

    videoSource.encodeQueueSize = 3;
    await vi.advanceTimersByTimeAsync(2);
    await expect(waitPromise).resolves.toBeUndefined();
  });

  it('does not stall while the queue is below the (deeper) default threshold', async () => {
    // Default depth is EXPORT_ENCODER_QUEUE_DEPTH (8); a queue of 7 must not wait.
    await expect(waitForVideoBackpressure({ encodeQueueSize: 7 })).resolves.toBeUndefined();
  });
});

describe('createCoalescedExportProgressReporter', () => {
  it('does not block callers and coalesces progress while a host call is in flight', async () => {
    const first = createDeferred();
    const onExportProgress = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const reporter = createCoalescedExportProgressReporter({ onExportProgress });

    reporter.report(10, 'task-1');
    reporter.report(20, 'task-1');
    reporter.report(30, 'task-1');

    expect(onExportProgress).toHaveBeenCalledTimes(1);
    expect(onExportProgress).toHaveBeenCalledWith(10, 'task-1');

    first.resolve();
    await reporter.flush();

    expect(onExportProgress).toHaveBeenCalledTimes(2);
    expect(onExportProgress).toHaveBeenLastCalledWith(30, 'task-1');
  });

  it('ignores host progress errors and continues flushing pending progress', async () => {
    const onExportProgress = vi
      .fn()
      .mockRejectedValueOnce(new Error('main thread busy'))
      .mockResolvedValue(undefined);
    const reporter = createCoalescedExportProgressReporter({ onExportProgress });

    reporter.report(40, 'task-2');
    reporter.report(50, 'task-2');
    await reporter.flush();

    expect(onExportProgress).toHaveBeenCalledTimes(2);
    expect(onExportProgress).toHaveBeenLastCalledWith(50, 'task-2');
  });
});

describe('createExportWriterProgressAggregator', () => {
  it('combines audio and video writer progress before finalization', () => {
    const progressReporter = {
      report: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    const aggregator = createExportWriterProgressAggregator({
      progressReporter,
      taskId: 'task-3',
      writerIds: ['video', 'audio'],
    });

    aggregator.report('video', 1);
    aggregator.report('audio', 0.5);
    aggregator.report('audio', 1);

    expect(progressReporter.report).toHaveBeenNthCalledWith(1, 49, 'task-3');
    expect(progressReporter.report).toHaveBeenNthCalledWith(2, 74, 'task-3');
    expect(progressReporter.report).toHaveBeenNthCalledWith(3, 98, 'task-3');
  });

  it('ignores regressions and unknown writers', () => {
    const progressReporter = {
      report: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    const aggregator = createExportWriterProgressAggregator({
      progressReporter,
      writerIds: ['audio'],
    });

    aggregator.report('audio', 0.5);
    aggregator.report('audio', 0.25);
    aggregator.report('video', 1);

    expect(progressReporter.report).toHaveBeenCalledTimes(1);
    expect(progressReporter.report).toHaveBeenCalledWith(49, undefined);
  });
});

describe('isVideoEncoderConfigSupported', () => {
  it('returns null when VideoEncoder support probing is unavailable', async () => {
    await expect(
      isVideoEncoderConfigSupported({
        codec: 'avc1.640032',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 8_000_000,
        hardwareAcceleration: 'prefer-hardware',
      }),
    ).resolves.toBeNull();
  });

  it('probes the exact WebCodecs encoder config', async () => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: true });
    (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = { isConfigSupported };

    await expect(
      isVideoEncoderConfigSupported({
        codec: 'avc1.640032',
        width: 1920,
        height: 1080,
        fps: 60,
        bitrate: 12_000_000,
        hardwareAcceleration: 'prefer-hardware',
      }),
    ).resolves.toBe(true);

    expect(isConfigSupported).toHaveBeenCalledWith({
      codec: 'avc1.640032',
      width: 1920,
      height: 1080,
      framerate: 60,
      bitrate: 12_000_000,
      hardwareAcceleration: 'prefer-hardware',
    });
  });

  it('returns false when WebCodecs rejects the config', async () => {
    (globalThis as unknown as { VideoEncoder: unknown }).VideoEncoder = {
      isConfigSupported: vi.fn().mockRejectedValue(new Error('unsupported')),
    };

    await expect(
      isVideoEncoderConfigSupported({
        codec: 'av01.0.05M.08',
        width: 3840,
        height: 2160,
        fps: 60,
        bitrate: 25_000_000,
        hardwareAcceleration: 'prefer-hardware',
      }),
    ).resolves.toBe(false);
  });
});
