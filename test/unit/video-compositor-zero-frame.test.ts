// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getVideoSampleWithZeroFallback,
  ResourceManager,
} from '../../src/utils/video-editor/compositor/ResourceManager';

describe('getVideoSampleWithZeroFallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns sample at non-zero time without retry', async () => {
    const sink = {
      getSample: vi.fn(async (timeS: number) => (timeS === 0.5 ? { id: 'frame' } : null)),
    };

    const sample = await getVideoSampleWithZeroFallback(sink as any, 0.5);

    expect(sample).toEqual({ id: 'frame' });
    expect(sink.getSample).toHaveBeenCalledTimes(1);
    expect(sink.getSample).toHaveBeenCalledWith(0.5);
  });

  it('falls back to firstTimestampS when requested time is before first sample', async () => {
    const sink = {
      getSample: vi.fn(async (timeS: number) => (timeS >= 0.04 ? { id: 'first-frame' } : null)),
    };

    const sample = await getVideoSampleWithZeroFallback(sink as any, 0, 0.04);

    expect(sample).toEqual({ id: 'first-frame' });
    expect(sink.getSample).toHaveBeenCalledTimes(2);
    expect(sink.getSample).toHaveBeenNthCalledWith(1, 0);
    expect(sink.getSample).toHaveBeenNthCalledWith(2, 0.04);
  });

  it('retries with epsilon when time is exactly 0 and no firstTimestampS fallback is provided', async () => {
    const sink = {
      getSample: vi.fn(async (timeS: number) => (timeS > 0 ? { id: 'first-frame' } : null)),
    };

    const sample = await getVideoSampleWithZeroFallback(sink as any, 0);

    expect(sample).toEqual({ id: 'first-frame' });
    expect(sink.getSample).toHaveBeenCalledTimes(2);
    expect(sink.getSample).toHaveBeenNthCalledWith(1, 0);
    expect(sink.getSample).toHaveBeenNthCalledWith(2, 1e-6);
  });

  it('does not retry when time is non-zero and primary sample is null', async () => {
    const sink = {
      getSample: vi.fn(async () => null),
    };

    const sample = await getVideoSampleWithZeroFallback(sink as any, 1);

    expect(sample).toBeNull();
    expect(sink.getSample).toHaveBeenCalledTimes(1);
  });

  it('times out stuck sample requests instead of blocking forever', async () => {
    vi.useFakeTimers();

    const manager = new ResourceManager();
    const promise = manager.withVideoSampleSlot(() => new Promise<null>(() => {}));
    const assertion = expect(promise).rejects.toThrow('Timed out while reading video sample');

    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
  });

  it('rejects stuck sample requests on abort', async () => {
    const manager = new ResourceManager();
    const controller = new AbortController();
    const promise = manager.withVideoSampleSlot(
      () => new Promise<null>(() => {}),
      controller.signal,
    );

    controller.abort();

    await expect(promise).rejects.toThrow('Aborted while reading video sample');
  });
});
