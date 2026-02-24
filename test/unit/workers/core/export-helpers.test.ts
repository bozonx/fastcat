import { describe, it, expect } from 'vitest';

import { computeMaxAudioDurationUs, getClipRangesS } from '../../../../src/workers/core/export-helpers';

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
});
