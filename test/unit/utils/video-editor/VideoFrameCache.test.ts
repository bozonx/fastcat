/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { TICKS_PER_MICROSECOND } from '~/utils/time';

import {
  VideoFrameCache,
  computeFrameIndex,
  buildVideoFrameCacheKey,
  estimateVideoFrameSizeBytes,
} from '~/utils/video-editor/compositor/VideoFrameCache';

function makeFrame(overrides: Record<string, unknown> = {}): VideoFrame {
  return {
    close: vi.fn(),
    closed: false,
    codedWidth: 1920,
    codedHeight: 1080,
    ...overrides,
  } as unknown as VideoFrame;
}

function makeEntry(
  key: string,
  clipId: string,
  frame: VideoFrame,
  sizeBytes: number,
  timelineTimeUs = 0,
): import('~/utils/video-editor/compositor/VideoFrameCache').CachedVideoFrameEntry {
  return {
    key,
    clipId,
    frameIndex: 0,
    timelineTimeUs,
    frame,
    sizeBytes,
    width: 1920,
    height: 1080,
  };
}

describe('VideoFrameCache', () => {
  describe('set / get', () => {
    it('stores and retrieves a frame by key', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame = makeFrame();
      const entry = makeEntry('clip:0', 'clip', frame, 1000);
      cache.set(entry);
      const retrieved = cache.get('clip:0');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.frame).toBe(frame);
    });

    it('returns null for missing key', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('returns null and removes entry for closed frame', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame = makeFrame({ closed: true });
      const entry = makeEntry('clip:0', 'clip', frame, 1000);
      cache.set(entry);
      expect(cache.get('clip:0')).toBeNull();
      // Second call should also return null (entry was removed)
      expect(cache.get('clip:0')).toBeNull();
    });

    it('replaces existing entry and closes old frame', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();
      cache.set(makeEntry('clip:0', 'clip', frame1, 1000));
      cache.set(makeEntry('clip:0', 'clip', frame2, 2000));
      expect(cache.get('clip:0')!.frame).toBe(frame2);
      expect(frame1.close).toHaveBeenCalled();
    });

    it('closes frame immediately when cache limit is 0', () => {
      const cache = new VideoFrameCache(0);
      const frame = makeFrame();
      cache.set(makeEntry('clip:0', 'clip', frame, 1000));
      expect(frame.close).toHaveBeenCalled();
      expect(cache.get('clip:0')).toBeNull();
    });
  });

  describe('eviction', () => {
    it('evicts oldest entries when capacity is exceeded', () => {
      // 3 entries of 1MB each, cache limit 2MB
      const cache = new VideoFrameCache(2 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();
      const frame3 = makeFrame();

      cache.set(makeEntry('clip:0', 'clip', frame1, 1024 * 1024));
      cache.set(makeEntry('clip:1', 'clip', frame2, 1024 * 1024));
      // Adding third should evict first (oldest)
      cache.set(makeEntry('clip:2', 'clip', frame3, 1024 * 1024));

      expect(frame1.close).toHaveBeenCalled();
      expect(cache.get('clip:0')).toBeNull();
      expect(cache.get('clip:1')).not.toBeNull();
      expect(cache.get('clip:2')).not.toBeNull();
    });

    it('does not evict when under capacity', () => {
      const cache = new VideoFrameCache(10 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();

      cache.set(makeEntry('clip:0', 'clip', frame1, 1024 * 1024));
      cache.set(makeEntry('clip:1', 'clip', frame2, 1024 * 1024));

      expect(frame1.close).not.toHaveBeenCalled();
      expect(cache.get('clip:0')).not.toBeNull();
      expect(cache.get('clip:1')).not.toBeNull();
    });

    it('evicts frames farthest from the current priority time first', () => {
      const cache = new VideoFrameCache(2 * 1024 * 1024);
      const before = makeFrame();
      const current = makeFrame();
      const after = makeFrame();

      cache.setPriorityTimeUs(10_000_000);
      cache.set(makeEntry('clip:before', 'clip', before, 1024 * 1024, 1_000_000));
      cache.set(makeEntry('clip:current', 'clip', current, 1024 * 1024, 10_000_000));
      cache.set(makeEntry('clip:after', 'clip', after, 1024 * 1024, 12_000_000));

      expect(before.close).toHaveBeenCalled();
      expect(current.close).not.toHaveBeenCalled();
      expect(after.close).not.toHaveBeenCalled();
      expect(cache.get('clip:before')).toBeNull();
      expect(cache.get('clip:current')).not.toBeNull();
      expect(cache.get('clip:after')).not.toBeNull();
    });

    it('re-evicts far frames when the priority moves backwards', () => {
      const cache = new VideoFrameCache(2 * 1024 * 1024);
      const nearBack = makeFrame();
      const mid = makeFrame();
      const farForward = makeFrame();

      cache.setPriorityTimeUs(20_000_000);
      cache.set(makeEntry('clip:near-back', 'clip', nearBack, 1024 * 1024, 9_500_000));
      cache.set(makeEntry('clip:mid', 'clip', mid, 1024 * 1024, 10_000_000));
      cache.set(makeEntry('clip:far-forward', 'clip', farForward, 1024 * 1024, 20_000_000));
      expect(nearBack.close).toHaveBeenCalled();

      cache.setPriorityTimeUs(9_500_000);
      cache.set(makeEntry('clip:near-back-2', 'clip', makeFrame(), 1024 * 1024, 9_500_000));

      expect(farForward.close).toHaveBeenCalled();
      expect(cache.get('clip:far-forward')).toBeNull();
      expect(cache.get('clip:mid')).not.toBeNull();
      expect(cache.get('clip:near-back-2')).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes entry and closes frame', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame = makeFrame();
      cache.set(makeEntry('clip:0', 'clip', frame, 1000));
      expect(cache.delete('clip:0')).toBe(true);
      expect(frame.close).toHaveBeenCalled();
      expect(cache.get('clip:0')).toBeNull();
    });

    it('returns false for missing key', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clearForClip', () => {
    it('removes all entries for a given clipId', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();
      const frame3 = makeFrame();

      cache.set(makeEntry('clipA:0', 'clipA', frame1, 1000));
      cache.set(makeEntry('clipA:1', 'clipA', frame2, 1000));
      cache.set(makeEntry('clipB:0', 'clipB', frame3, 1000));

      cache.clearForClip('clipA');

      expect(cache.get('clipA:0')).toBeNull();
      expect(cache.get('clipA:1')).toBeNull();
      expect(cache.get('clipB:0')).not.toBeNull();
      expect(frame1.close).toHaveBeenCalled();
      expect(frame2.close).toHaveBeenCalled();
      expect(frame3.close).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes all entries and closes all frames', () => {
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();

      cache.set(makeEntry('clipA:0', 'clipA', frame1, 1000));
      cache.set(makeEntry('clipB:0', 'clipB', frame2, 1000));

      cache.clear();

      expect(cache.get('clipA:0')).toBeNull();
      expect(cache.get('clipB:0')).toBeNull();
      expect(frame1.close).toHaveBeenCalled();
      expect(frame2.close).toHaveBeenCalled();
    });
  });

  describe('applyLimitMb', () => {
    it('updates the cache limit and evicts if needed', () => {
      const cache = new VideoFrameCache(10 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();

      cache.set(makeEntry('clip:0', 'clip', frame1, 5 * 1024 * 1024));
      cache.set(makeEntry('clip:1', 'clip', frame2, 5 * 1024 * 1024));

      // Reduce to 6MB → should evict oldest
      cache.applyLimitMb(6);
      expect(frame1.close).toHaveBeenCalled();
      expect(cache.get('clip:0')).toBeNull();
      expect(cache.get('clip:1')).not.toBeNull();
    });

    it('ignores non-finite values', () => {
      const cache = new VideoFrameCache(10 * 1024 * 1024);
      cache.applyLimitMb(NaN);
      cache.applyLimitMb(Infinity as unknown as number);
      // No throw, cache still works
      const frame = makeFrame();
      cache.set(makeEntry('clip:0', 'clip', frame, 1000));
      expect(cache.get('clip:0')).not.toBeNull();
    });

    it('drains cache when limit becomes 0', () => {
      const cache = new VideoFrameCache(10 * 1024 * 1024);
      const frame1 = makeFrame();
      const frame2 = makeFrame();

      cache.set(makeEntry('clip:0', 'clip', frame1, 1024 * 1024));
      cache.set(makeEntry('clip:1', 'clip', frame2, 1024 * 1024));

      cache.applyLimitMb(0);
      expect(frame1.close).toHaveBeenCalled();
      expect(frame2.close).toHaveBeenCalled();
      expect(cache.get('clip:0')).toBeNull();
      expect(cache.get('clip:1')).toBeNull();
    });
  });
});

describe('computeFrameIndex', () => {
  it('uses frame rate to compute index when available', () => {
    const clip = { itemId: 'clip', frameRate: 30, firstTimestampS: 0 };
    expect(computeFrameIndex(clip, 1.0)).toBe(30);
    expect(computeFrameIndex(clip, 2.5)).toBe(75);
  });

  it('subtracts firstTimestampS origin', () => {
    const clip = { itemId: 'clip', frameRate: 25, firstTimestampS: 1.0 };
    expect(computeFrameIndex(clip, 1.0)).toBe(0);
    expect(computeFrameIndex(clip, 2.0)).toBe(25);
  });

  it('falls back to microsecond key when no frame rate', () => {
    const clip = { itemId: 'clip' };
    expect(computeFrameIndex(clip, 0.5)).toBe(500_000 * TICKS_PER_MICROSECOND);
  });

  it('keys cached frames by source fps, not timeline cadence', () => {
    const clip = { itemId: 'clip', frameRate: 24, firstTimestampS: 0 };

    expect(computeFrameIndex(clip, 0)).toBe(0);
    expect(computeFrameIndex(clip, 1 / 30)).toBe(0);
    expect(computeFrameIndex(clip, 2 / 30)).toBe(1);
    expect(computeFrameIndex(clip, 3 / 30)).toBe(2);
  });

  it('clamps negative times to 0', () => {
    const clip = { itemId: 'clip', frameRate: 30 };
    expect(computeFrameIndex(clip, -1)).toBe(0);
  });
});

describe('buildVideoFrameCacheKey', () => {
  it('builds key from itemId and frameIndex', () => {
    expect(buildVideoFrameCacheKey({ itemId: 'clip1' }, 42)).toBe('clip1:42');
  });
});

describe('estimateVideoFrameSizeBytes', () => {
  it('uses allocationSize when available', () => {
    const frame = {
      codedWidth: 1920,
      codedHeight: 1080,
      allocationSize: () => 8_294_400,
    } as unknown as VideoFrame;
    const size = estimateVideoFrameSizeBytes(frame, 1920, 1080);
    // allocationSize * 1.2
    expect(size).toBe(Math.ceil(8_294_400 * 1.2));
  });

  it('falls back to aligned width * height * 4 * 1.5', () => {
    const frame = {
      codedWidth: 1920,
      codedHeight: 1080,
    } as unknown as VideoFrame;
    const size = estimateVideoFrameSizeBytes(frame, 1920, 1080);
    // 1920 aligned to 64 = 1920 (already aligned)
    // 1920 * 1080 * 4 * 1.5
    expect(size).toBe(Math.ceil(1920 * 1080 * 4 * 1.5));
  });

  it('aligns width to 64 bytes', () => {
    const frame = {
      codedWidth: 1900,
      codedHeight: 1080,
    } as unknown as VideoFrame;
    const size = estimateVideoFrameSizeBytes(frame, 1900, 1080);
    const alignedWidth = Math.ceil(1900 / 64) * 64;
    expect(size).toBe(Math.ceil(alignedWidth * 1080 * 4 * 1.5));
  });
});
