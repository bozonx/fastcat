import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WAVEFORM_EXTRACTION_PRIORITIES,
  runQueuedPeakExtraction,
  __resetWaveformExtractionQueueForTesting,
} from '~/utils/audio/waveform-extraction-queue';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe('waveform extraction queue', () => {
  beforeEach(() => {
    __resetWaveformExtractionQueueForTesting(1);
  });

  it('runs peak extraction tasks one file at a time', async () => {
    const firstGate = createDeferred<Float32Array[] | null>();
    const events: string[] = [];

    const first = runQueuedPeakExtraction({
      path: 'video/first.mp4',
      task: async () => {
        events.push('first:start');
        return await firstGate.promise;
      },
    });

    const second = runQueuedPeakExtraction({
      path: 'video/second.mp4',
      task: async () => {
        events.push('second:start');
        return [new Float32Array([2])];
      },
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['first:start']);
    });

    firstGate.resolve([new Float32Array([1])]);
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(events).toEqual(['first:start', 'second:start']);
  });

  it('shares an in-flight extraction for the same file', async () => {
    const task = vi.fn(async () => [new Float32Array([1])]);

    const first = runQueuedPeakExtraction({ path: 'video/shared.mp4', task });
    const second = runQueuedPeakExtraction({ path: 'video/shared.mp4', task });

    expect(first).toBe(second);
    await expect(first).resolves.toHaveLength(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not share in-flight extractions when cache keys differ', async () => {
    const low = vi.fn(async () => [new Float32Array([1])]);
    const high = vi.fn(async () => [new Float32Array([1, 2])]);

    const first = runQueuedPeakExtraction({
      path: 'video/shared.mp4',
      cacheKey: 'video/shared.mp4:100',
      task: low,
    });
    const second = runQueuedPeakExtraction({
      path: 'video/shared.mp4',
      cacheKey: 'video/shared.mp4:1000',
      task: high,
    });

    expect(first).not.toBe(second);
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(low).toHaveBeenCalledTimes(1);
    expect(high).toHaveBeenCalledTimes(1);
  });

  it('starts higher-priority pending extractions first', async () => {
    const firstGate = createDeferred<Float32Array[] | null>();
    const events: string[] = [];

    const first = runQueuedPeakExtraction({
      path: 'video/current.mp4',
      task: async () => {
        events.push('current:start');
        return await firstGate.promise;
      },
    });

    const prefetch = runQueuedPeakExtraction({
      path: 'video/prefetch.mp4',
      priority: WAVEFORM_EXTRACTION_PRIORITIES.prefetch,
      task: async () => {
        events.push('prefetch:start');
        return [new Float32Array([2])];
      },
    });

    const selected = runQueuedPeakExtraction({
      path: 'video/selected.mp4',
      priority: WAVEFORM_EXTRACTION_PRIORITIES.selectedClip,
      task: async () => {
        events.push('selected:start');
        return [new Float32Array([3])];
      },
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['current:start']);
    });

    firstGate.resolve([new Float32Array([1])]);
    await expect(first).resolves.toHaveLength(1);
    await expect(selected).resolves.toHaveLength(1);
    await expect(prefetch).resolves.toHaveLength(1);
    expect(events).toEqual(['current:start', 'selected:start', 'prefetch:start']);
  });
});
