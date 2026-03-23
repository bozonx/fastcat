import { describe, it, expect } from 'vitest';
import {
  clampHandlePx,
  getClipHeadTimelineHandleUs,
  getClipTailTimelineHandleUs,
} from '~/utils/timeline/clip';
import type { TimelineClipItem } from '~/timeline/types';

describe('utils/timeline/clip', () => {
  it('clampHandlePx clamps to clip padding', () => {
    expect(clampHandlePx(0, 100)).toBe(3);
    expect(clampHandlePx(200, 100)).toBe(97);
    expect(clampHandlePx(50, 100)).toBe(50);
  });

  const baseClip: Partial<TimelineClipItem> = {
    kind: 'clip',
    clipType: 'media',
    sourceRange: { startUs: 2000, durationUs: 3000 },
    sourceDurationUs: 10000,
  };

  describe('handle timeline durations', () => {
    it('normal speed (1.0)', () => {
      const clip = { ...baseClip, speed: 1.0 } as TimelineClipItem;
      // head: source (2000) / 1.0 = 2000
      // tail: (10000 - (2000 + 3000)) = 5000 / 1.0 = 5000
      expect(getClipHeadTimelineHandleUs(clip)).toBe(2000);
      expect(getClipTailTimelineHandleUs(clip)).toBe(5000);
    });

    it('double speed (2.0)', () => {
      const clip = { ...baseClip, speed: 2.0 } as TimelineClipItem;
      // head: source (2000) / 2.0 = 1000
      // tail: source (5000) / 2.0 = 2500
      expect(getClipHeadTimelineHandleUs(clip)).toBe(1000);
      expect(getClipTailTimelineHandleUs(clip)).toBe(2500);
    });

    it('half speed (0.5)', () => {
      const clip = { ...baseClip, speed: 0.5 } as TimelineClipItem;
      // head: 2000 / 0.5 = 4000
      // tail: 5000 / 0.5 = 10000
      expect(getClipHeadTimelineHandleUs(clip)).toBe(4000);
      expect(getClipTailTimelineHandleUs(clip)).toBe(10000);
    });

    it('reverse speed (-1.0)', () => {
      const clip = { ...baseClip, speed: -1.0 } as TimelineClipItem;
      // head on timeline corresponds to physical tail in source
      // head: sourceTail (5000) / 1.0 = 5000
      // tail: sourceHead (2000) / 1.0 = 2000
      expect(getClipHeadTimelineHandleUs(clip)).toBe(5000);
      expect(getClipTailTimelineHandleUs(clip)).toBe(2000);
    });

    it('reverse speed (-2.0)', () => {
      const clip = { ...baseClip, speed: -2.0 } as TimelineClipItem;
      // head: sourceTail (5000) / 2.0 = 2500
      // tail: sourceHead (2000) / 2.0 = 1000
      expect(getClipHeadTimelineHandleUs(clip)).toBe(2500);
      expect(getClipTailTimelineHandleUs(clip)).toBe(1000);
    });

    it('handles image clip (infinite handles)', () => {
      const clip = { ...baseClip, speed: 1.0, isImage: true } as TimelineClipItem;
      expect(getClipHeadTimelineHandleUs(clip)).toBe(Number.POSITIVE_INFINITY);
      expect(getClipTailTimelineHandleUs(clip)).toBe(Number.POSITIVE_INFINITY);
    });

    it('handles speed 0 (safe fallback)', () => {
      const clip = { ...baseClip, speed: 0 } as TimelineClipItem;
      expect(getClipHeadTimelineHandleUs(clip)).toBe(Number.POSITIVE_INFINITY);
      expect(getClipTailTimelineHandleUs(clip)).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
