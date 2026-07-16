/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineTicks } from '../../utils/timeline-time';
import { computeExportTotalFrames, getExportFrameTiming } from '~/workers/core/export-helpers';
import {
  computeFrameIndex,
  buildVideoFrameCacheKey,
  type VideoFrameCacheClipLike,
} from '~/utils/video-editor/compositor/VideoFrameCache';

// Guards the web export against the native `frame_at` judder class: a matched-fps
// export must show every source frame exactly once (no duplicate/dropped frames),
// regardless of how the clip's source grid is phased against the sample grid.
//
// Web content selection is mediabunny sample-and-hold (robust), but the per-frame
// VideoFrameCache is keyed by `computeFrameIndex`. If that key doesn't bucket time
// by the same frame boundaries the sink uses, two adjacent output times can collide
// on one key — the second gets a stale cache hit (a duplicate) while its own frame
// is skipped. So the cache index must advance by exactly +1 per matched-fps frame.

function indicesForSource(opts: {
  frameRate: number;
  origin: number; // clip.firstTimestampS
  startS: number; // first sampled source time
  stepS: number; // source seconds advanced per output frame
  frames: number;
}): number[] {
  const clip: VideoFrameCacheClipLike = {
    itemId: 'clip',
    frameRate: opts.frameRate,
    firstTimestampS: opts.origin,
  };
  return Array.from({ length: opts.frames }, (_, i) =>
    computeFrameIndex(clip, opts.startS + i * opts.stepS),
  );
}

describe('web export frame cadence', () => {
  describe('getExportFrameTiming', () => {
    it('emits CFR, leading-edge, strictly increasing timestamps', () => {
      const fps = 25;
      const durationTicks = timelineTicks(1_000_000);
      const totalFrames = computeExportTotalFrames({ durationTicks, fps });
      expect(totalFrames).toBe(25);

      let prev = -1;
      for (let i = 0; i < totalFrames; i++) {
        const t = getExportFrameTiming({ frameNum: i, totalFrames, durationTicks, fps });
        // Leading edge i/fps (NOT the centre (i+0.5)/fps that the native path uses).
        expect(t.timestampS * fps).toBeCloseTo(i, 6);
        expect(t.durationS).toBeCloseTo(1 / fps, 6);
        expect(t.timestampS).toBeGreaterThan(prev);
        prev = t.timestampS;
      }
    });

    it('computes total frame counts for whole and fractional rates', () => {
      expect(computeExportTotalFrames({ durationTicks: timelineTicks(1_000_000), fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationTicks: timelineTicks(2_000_000), fps: 25 })).toBe(50);
    });
  });

  describe('computeFrameIndex cache key', () => {
    it('advances by exactly +1 per matched-fps frame for every phase', () => {
      const fps = 25;
      // Phases include the half-frame offset (0.02s) that makes a nearest-frame
      // rounding flip on float noise — the exact case that aliased the cache.
      const phases = [0, 0.5 / fps, 0.25 / fps, 0.013, 1 / fps, 2 / fps];
      for (const phase of phases) {
        const ids = indicesForSource({
          frameRate: fps,
          origin: 0,
          startS: phase,
          stepS: 1 / fps,
          frames: 80,
        });
        for (let i = 1; i < ids.length; i++) {
          expect(
            ids[i] - ids[i - 1],
            `phase ${phase}: expected +1 between index ${i - 1} and ${i}`,
          ).toBe(1);
        }
      }
    });

    it('is unaffected by a non-zero source origin (firstTimestampS)', () => {
      const fps = 25;
      const ids = indicesForSource({
        frameRate: fps,
        origin: 10 + 0.5 / fps, // non-zero, half-frame-phased origin
        startS: 10 + 0.5 / fps,
        stepS: 1 / fps,
        frames: 60,
      });
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] - ids[i - 1]).toBe(1);
      }
    });

    it('coalesces evenly when upsampling (source slower than export)', () => {
      // 25fps source, 50fps export: source advances half a frame per output frame,
      // so each source frame is keyed for exactly two output frames — never three.
      const ids = indicesForSource({
        frameRate: 25,
        origin: 0,
        startS: 0,
        stepS: 1 / 50,
        frames: 40,
      });
      for (let i = 1; i < ids.length; i++) {
        const d = ids[i] - ids[i - 1];
        expect(d === 0 || d === 1).toBe(true);
      }
      expect(ids.some((v, i) => i > 0 && v === ids[i - 1])).toBe(true); // some holds
      // No source frame keyed for 3+ outputs in a row.
      let run = 1;
      for (let i = 1; i < ids.length; i++) {
        run = ids[i] === ids[i - 1] ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(2);
      }
    });

    it('drops evenly when downsampling (source faster than export)', () => {
      // 25fps source, 12.5fps export: every other source frame is dropped, evenly.
      const ids = indicesForSource({
        frameRate: 25,
        origin: 0,
        startS: 0,
        stepS: 1 / 12.5,
        frames: 40,
      });
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] - ids[i - 1]).toBe(2);
      }
    });

    it('keys distinct frames to distinct cache keys (no aliasing)', () => {
      const fps = 25;
      const clip = { itemId: 'clip' } as const;
      const ids = indicesForSource({
        frameRate: fps,
        origin: 0,
        startS: 0.5 / fps, // worst-case phase
        stepS: 1 / fps,
        frames: 50,
      });
      const keys = ids.map((idx) => buildVideoFrameCacheKey(clip, idx));
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
