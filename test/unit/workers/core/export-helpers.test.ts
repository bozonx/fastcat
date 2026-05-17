// @vitest-environment node
import { describe, it, expect } from 'vitest';

import {
  computeExportTotalFrames,
  computeMaxAudioDurationUs,
  getClipRangesS,
  getExportFrameTiming,
} from '~/workers/core/export-helpers';

describe('export-helpers', () => {
  describe('getClipRangesS', () => {
    it('maps timeline/source ranges from us to s and computes sourceEndS', () => {
      const clip = {
        timelineRange: { startUs: 2_000_000, durationUs: 4_000_000 },
        sourceRange: { startUs: 1_000_000, durationUs: 3_000_000 },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 2,
        sourceStartS: 1,
        sourceEndS: 4,
      });
    });

    it('clamps negative values to 0', () => {
      const clip = {
        timelineRange: { startUs: -1_000_000, durationUs: 2_000_000 },
        sourceRange: { startUs: -3_000_000, durationUs: 1_000_000 },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 0,
        sourceStartS: 0,
        sourceEndS: 1,
      });
    });

    it('falls back to timeline duration if source duration is missing', () => {
      const clip = {
        timelineRange: { startUs: 0, durationUs: 2_500_000 },
        sourceRange: { startUs: 0 },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 0,
        sourceStartS: 0,
        sourceEndS: 2.5,
      });
    });
  });

  describe('computeMaxAudioDurationUs', () => {
    it('returns 0 for empty clips', () => {
      expect(computeMaxAudioDurationUs([])).toBe(0);
    });

    it('computes max endUs across clips', () => {
      const clips = [
        { timelineRange: { startUs: 0, durationUs: 2_000_000 } },
        { timelineRange: { startUs: 1_000_000, durationUs: 10_000_000 } },
        { timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 } },
      ];

      expect(computeMaxAudioDurationUs(clips)).toBe(11_000_000);
    });

    it('treats missing fields as 0', () => {
      const clips = [{}, { timelineRange: { startUs: 1_000_000 } }];
      expect(computeMaxAudioDurationUs(clips)).toBe(1_000_000);
    });
  });

  describe('export frame timing', () => {
    it('computes total frames from exact timeline duration and fps', () => {
      expect(computeExportTotalFrames({ durationUs: 1_000_000, fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationUs: 1_000_000, fps: 29.97 })).toBe(30);
      expect(computeExportTotalFrames({ durationUs: 1_001_000, fps: 30 })).toBe(31);
    });

    it('does not accumulate timing drift for non-integer fps', () => {
      const fps = 29.97;
      const durationUs = 60 * 60 * 1_000_000;
      const totalFrames = computeExportTotalFrames({ durationUs, fps });
      const frame = getExportFrameTiming({
        frameNum: totalFrames - 2,
        totalFrames,
        durationUs,
        fps,
      });

      expect(frame.timeUs).toBe(Math.round(((totalFrames - 2) * 1_000_000) / fps));
      expect(frame.timestampS).toBe(frame.timeUs / 1_000_000);
      expect(frame.durationS).toBeGreaterThan(0);
    });

    it('clips the final frame duration to the requested timeline duration', () => {
      const fps = 30;
      const durationUs = 1_000_001;
      const totalFrames = computeExportTotalFrames({ durationUs, fps });
      const lastFrame = getExportFrameTiming({
        frameNum: totalFrames - 1,
        totalFrames,
        durationUs,
        fps,
      });

      expect(lastFrame.timeUs).toBe(1_000_000);
      expect(lastFrame.durationS).toBeCloseTo(0.000001);
      expect(lastFrame.timestampS + lastFrame.durationS).toBeCloseTo(durationUs / 1_000_000);
    });
  });
});
