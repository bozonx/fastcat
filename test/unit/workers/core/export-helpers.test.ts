// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TICKS_PER_SECOND } from '~/utils/time';
import { timelineUs } from '../../utils/timeline-time';

import {
  computeExportTotalFrames,
  computeMaxAudioDurationUs,
  getClipRangesS,
  getExportFrameTiming,
} from '~/workers/core/export-helpers';

describe('export-helpers', () => {
  describe('getClipRangesS', () => {
    it('maps timeline/source ranges from ticks to s and computes sourceEndS', () => {
      const clip = {
        timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(4_000_000) },
        sourceRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(3_000_000) },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 2,
        sourceStartS: 1,
        sourceEndS: 4,
      });
    });

    it('clamps negative values to 0', () => {
      const clip = {
        timelineRange: { startUs: -timelineUs(1_000_000), durationUs: timelineUs(2_000_000) },
        sourceRange: { startUs: -timelineUs(3_000_000), durationUs: timelineUs(1_000_000) },
      };

      expect(getClipRangesS(clip)).toEqual({
        timelineStartS: 0,
        sourceStartS: 0,
        sourceEndS: 1,
      });
    });

    it('falls back to timeline duration if source duration is missing', () => {
      const clip = {
        timelineRange: { startUs: 0, durationUs: timelineUs(2_500_000) },
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
        { timelineRange: { startUs: 0, durationUs: timelineUs(2_000_000) } },
        { timelineRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(10_000_000) } },
        { timelineRange: { startUs: timelineUs(5_000_000), durationUs: timelineUs(1_000_000) } },
      ];

      expect(computeMaxAudioDurationUs(clips)).toBe(timelineUs(11_000_000));
    });

    it('treats missing fields as 0', () => {
      const clips = [{}, { timelineRange: { startUs: timelineUs(1_000_000) } }];
      expect(computeMaxAudioDurationUs(clips)).toBe(timelineUs(1_000_000));
    });
  });

  describe('export frame timing', () => {
    it('computes total frames from exact timeline duration and fps', () => {
      expect(computeExportTotalFrames({ durationUs: timelineUs(1_000_000), fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationUs: timelineUs(1_000_000), fps: 29.97 })).toBe(30);
      expect(computeExportTotalFrames({ durationUs: timelineUs(1_001_000), fps: 30 })).toBe(30);
      expect(computeExportTotalFrames({ durationUs: timelineUs(1_017_000), fps: 30 })).toBe(31);
    });

    it('does not accumulate timing drift for non-integer fps', () => {
      const fps = 29.97;
      const durationUs = timelineUs(60 * 60 * 1_000_000);
      const totalFrames = computeExportTotalFrames({ durationUs, fps });
      const frame = getExportFrameTiming({
        frameNum: totalFrames - 2,
        totalFrames,
        durationUs,
        fps,
      });

      expect(frame.timeUs).toBe(Math.round(((totalFrames - 2) * TICKS_PER_SECOND * 1001) / 30000));
      expect(frame.timestampS).toBe(frame.timeUs / TICKS_PER_SECOND);
      expect(frame.durationS).toBeGreaterThan(0);
    });

    it('clips the final frame duration to the requested timeline duration', () => {
      const fps = 30;
      const durationUs = timelineUs(1_017_000);
      const totalFrames = computeExportTotalFrames({ durationUs, fps });
      const lastFrame = getExportFrameTiming({
        frameNum: totalFrames - 1,
        totalFrames,
        durationUs,
        fps,
      });

      expect(lastFrame.timeUs).toBe(timelineUs(1_000_000));
      expect(lastFrame.durationS).toBeCloseTo(0.017);
      expect(lastFrame.timestampS + lastFrame.durationS).toBeCloseTo(durationUs / TICKS_PER_SECOND);
    });
  });
});
