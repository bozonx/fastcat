// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TICKS_PER_SECOND } from '~/utils/time';

import {
  computeExportTotalFrames,
  computeMaxAudioDurationTicks,
  getClipRangesS,
  getExportFrameTiming,
} from '~/workers/core/export-helpers';

describe('export-helpers', () => {
  describe('getClipRangesS', () => {
    it('maps timeline/source ranges from ticks to s and computes sourceEndS', () => {
      const clip = {
        timelineRange: {
          startTicks: 508_032_000_000,
          durationTicks: 1_016_064_000_000,
        },
        sourceRange: {
          startTicks: 254_016_000_000,
          durationTicks: 762_048_000_000,
        },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 2,
        sourceStartS: 1,
        sourceEndS: 4,
      });
    });

    it('clamps negative values to 0', () => {
      const clip = {
        timelineRange: {
          startTicks: -254_016_000_000,
          durationTicks: 508_032_000_000,
        },
        sourceRange: {
          startTicks: -762_048_000_000,
          durationTicks: 254_016_000_000,
        },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 0,
        sourceStartS: 0,
        sourceEndS: 1,
      });
    });

    it('falls back to timeline duration if source duration is missing', () => {
      const clip = {
        timelineRange: { startTicks: 0, durationTicks: 635_040_000_000 },
        sourceRange: { startTicks: 0 },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 0,
        sourceStartS: 0,
        sourceEndS: 2.5,
      });
    });
  });

  describe('computeMaxAudioDurationTicks', () => {
    it('returns 0 for empty clips', () => {
      expect(computeMaxAudioDurationTicks([])).toBe(0);
    });

    it('computes max endTicks across clips', () => {
      const clips = [
        { timelineRange: { startTicks: 0, durationTicks: 508_032_000_000 } },
        {
          timelineRange: {
            startTicks: 254_016_000_000,
            durationTicks: 2_540_160_000_000,
          },
        },
        {
          timelineRange: {
            startTicks: 1_270_080_000_000,
            durationTicks: 254_016_000_000,
          },
        },
      ];

      expect(computeMaxAudioDurationTicks(clips)).toBe(2_794_176_000_000);
    });

    it('treats missing fields as 0', () => {
      const clips = [{}, { timelineRange: { startTicks: 254_016_000_000 } }];
      expect(computeMaxAudioDurationTicks(clips)).toBe(254_016_000_000);
    });
  });

  describe('export frame timing', () => {
    it('computes total frames from exact timeline duration and fps', () => {
      expect(computeExportTotalFrames({ durationTicks: 254_016_000_000, fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationTicks: 254_016_000_000, fps: 29.97 })).toBe(30);
      expect(computeExportTotalFrames({ durationTicks: 254_270_016_000, fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationTicks: 258_334_272_000, fps: 30 })).toBe(31);
    });

    it('does not accumulate timing drift for non-integer fps', () => {
      const fps = 29.97;
      const durationTicks = 60 * 60 * 1_000_000 * 254_016;
      const totalFrames = computeExportTotalFrames({ durationTicks, fps });
      const frame = getExportFrameTiming({
        frameNum: totalFrames - 2,
        totalFrames,
        durationTicks,
        fps,
      });

      expect(frame.timeTicks).toBe(
        Math.round(((totalFrames - 2) * TICKS_PER_SECOND * 1001) / 30000),
      );
      expect(frame.timestampS).toBe(frame.timeTicks / TICKS_PER_SECOND);
      expect(frame.durationS).toBeGreaterThan(0);
    });

    it('clips the final frame duration to the requested timeline duration', () => {
      const fps = 30;
      const durationTicks = 258_334_272_000;
      const totalFrames = computeExportTotalFrames({ durationTicks, fps });
      const lastFrame = getExportFrameTiming({
        frameNum: totalFrames - 1,
        totalFrames,
        durationTicks,
        fps,
      });

      expect(lastFrame.timeTicks).toBe(254_016_000_000);
      expect(lastFrame.durationS).toBeCloseTo(0.017);
      expect(lastFrame.timestampS + lastFrame.durationS).toBeCloseTo(
        durationTicks / TICKS_PER_SECOND,
      );
    });
  });
});
