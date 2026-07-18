/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { computeExportTotalFrames, getExportFrameTiming } from '~/workers/core/export-helpers';
import {
  VideoFrameCache,
  computeFrameKeyMs,
  buildVideoFrameCacheKey,
} from '~/utils/video-editor/compositor/VideoFrameCache';

// Guards the web export against the native `frame_at` judder class: a matched-fps
// export must show every source frame exactly once (no duplicate/dropped frames),
// regardless of how the clip's source grid is phased against the sample grid.
//
// Web content selection is mediabunny sample-and-hold (robust); the per-frame
// VideoFrameCache is keyed by each decoded frame's own PTS (ms grid) and queried by
// `frameLe`. This test drives a real cache the way the decode-ahead + render path
// does — insert source frames at their PTS, then query at output times — and asserts
// the served source-frame sequence advances correctly for every phase / resample.

function makeFrame(): VideoFrame {
  return { close: vi.fn(), closed: false, codedWidth: 4, codedHeight: 4 } as unknown as VideoFrame;
}

// Returns the ms key of the frame the cache serves at each output time, having first
// populated the cache densely with the source's CFR (or explicit) PTS grid — exactly
// what sequential decode-ahead does before the render reuses frames.
function servedKeysForSource(opts: {
  frameRate: number;
  originS: number; // first source PTS
  startS: number; // first sampled source time
  stepS: number; // source seconds advanced per output frame
  frames: number;
  sourcePtsS?: number[]; // explicit (e.g. VFR) source grid; overrides the CFR fill
}): number[] {
  const cache = new VideoFrameCache(100 * 1024 * 1024);
  const clipId = 'clip';
  const lastQueryS = opts.startS + (opts.frames - 1) * opts.stepS;
  const grid =
    opts.sourcePtsS ??
    Array.from(
      { length: Math.ceil((lastQueryS - opts.originS) * opts.frameRate) + 4 },
      (_, k) => opts.originS + k / opts.frameRate,
    );
  for (const pts of grid) {
    const keyMs = computeFrameKeyMs(pts);
    cache.set({
      key: buildVideoFrameCacheKey({ itemId: clipId }, keyMs),
      clipId,
      keyMs,
      timelineTimeTicks: 0,
      frame: makeFrame(),
      sizeBytes: 100,
      width: 4,
      height: 4,
    });
  }
  // Generous lag: the cache is dense, so `frameLe` must always hit.
  return Array.from({ length: opts.frames }, (_, i) => {
    const served = cache.frameLe(clipId, opts.startS + i * opts.stepS, 10);
    return served ? served.keyMs : -1;
  });
}

// Convenience: number of DISTINCT source frames advanced between two ms keys, using
// the CFR interval (ms) implied by frameRate.
function frameStep(prevMs: number, ms: number, frameRate: number): number {
  return Math.round(((ms - prevMs) / 1000) * frameRate);
}

describe('web export frame cadence', () => {
  describe('getExportFrameTiming', () => {
    it('emits CFR, leading-edge, strictly increasing timestamps', () => {
      const fps = 25;
      const durationTicks = 254_016_000_000;
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
      expect(computeExportTotalFrames({ durationTicks: 254_016_000_000, fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationTicks: 508_032_000_000, fps: 25 })).toBe(50);
    });
  });

  describe('PTS-ordered cache cadence (frameLe)', () => {
    it('advances by exactly one source frame per matched-fps output frame, every phase', () => {
      const fps = 25;
      // Phases include the half-frame offset (0.02s) that made a nearest-frame
      // rounding flip on float noise — the exact case that aliased the old cache.
      const phases = [0, 0.5 / fps, 0.25 / fps, 0.013, 1 / fps, 2 / fps];
      for (const phase of phases) {
        const keys = servedKeysForSource({
          frameRate: fps,
          originS: 0,
          startS: phase,
          stepS: 1 / fps,
          frames: 80,
        });
        for (let i = 1; i < keys.length; i++) {
          expect(
            frameStep(keys[i - 1], keys[i], fps),
            `phase ${phase}: expected +1 source frame between output ${i - 1} and ${i}`,
          ).toBe(1);
        }
      }
    });

    it('is unaffected by a non-zero source origin', () => {
      const fps = 25;
      const keys = servedKeysForSource({
        frameRate: fps,
        originS: 10 + 0.5 / fps, // non-zero, half-frame-phased origin
        startS: 10 + 0.5 / fps,
        stepS: 1 / fps,
        frames: 60,
      });
      for (let i = 1; i < keys.length; i++) {
        expect(frameStep(keys[i - 1], keys[i], fps)).toBe(1);
      }
    });

    it('coalesces evenly when upsampling (source slower than export)', () => {
      // 25fps source, 50fps export: source advances half a frame per output frame,
      // so each source frame is served for exactly two output frames — never three.
      const fps = 25;
      const keys = servedKeysForSource({
        frameRate: fps,
        originS: 0,
        startS: 0,
        stepS: 1 / 50,
        frames: 40,
      });
      for (let i = 1; i < keys.length; i++) {
        const d = frameStep(keys[i - 1], keys[i], fps);
        expect(d === 0 || d === 1).toBe(true);
      }
      expect(keys.some((v, i) => i > 0 && v === keys[i - 1])).toBe(true); // some holds
      let run = 1;
      for (let i = 1; i < keys.length; i++) {
        run = keys[i] === keys[i - 1] ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(2);
      }
    });

    it('drops evenly when downsampling (source faster than export)', () => {
      // 25fps source, 12.5fps export: every other source frame is dropped, evenly.
      const fps = 25;
      const keys = servedKeysForSource({
        frameRate: fps,
        originS: 0,
        startS: 0,
        stepS: 1 / 12.5,
        frames: 40,
      });
      for (let i = 1; i < keys.length; i++) {
        expect(frameStep(keys[i - 1], keys[i], fps)).toBe(2);
      }
    });

    it('shows every VFR frame once with no duplicate/skip (the whole point)', () => {
      // A VFR burst: nominal 25fps but with frames spaced 10–70ms apart. Under the old
      // floor(t*avgFps) key the 10ms-apart pair collapsed to one bucket (a duplicate);
      // the ms grid + frameLe serve each frame exactly once at its own moment.
      const sourcePtsS = [0.0, 0.01, 0.05, 0.09, 0.16, 0.2, 0.21, 0.25];
      const cache = new VideoFrameCache(100 * 1024 * 1024);
      for (const pts of sourcePtsS) {
        const keyMs = computeFrameKeyMs(pts);
        cache.set({
          key: buildVideoFrameCacheKey({ itemId: 'clip' }, keyMs),
          clipId: 'clip',
          keyMs,
          timelineTimeTicks: 0,
          frame: makeFrame(),
          sizeBytes: 100,
          width: 4,
          height: 4,
        });
      }
      const servedKeys = sourcePtsS.map((pts) => cache.frameLe('clip', pts + 0.001, 10)!.keyMs);
      // Each query returns its own distinct frame — no collisions.
      expect(new Set(servedKeys).size).toBe(sourcePtsS.length);
      expect(servedKeys).toEqual(sourcePtsS.map(computeFrameKeyMs));
    });
  });
});
