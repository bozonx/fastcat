// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { TICKS_PER_SECOND } from '~/utils/time';
import { VideoCompositor } from '~/utils/video-editor/VideoCompositor';

/**
 * Covers the decode-ahead cut-boundary fixes:
 *  A) buildActiveClipWarmPlans now head-warms imminent upcoming clips (within the
 *     head horizon), not only clips under the playhead.
 *  B) maybeProactivePrewarmOnClipEntry fires a prewarm the instant a video clip
 *     enters the active set while moving forward.
 */
describe('VideoCompositor decode-ahead prewarm', () => {
  const S = TICKS_PER_SECOND; // canonical ticks per second

  function videoClip(over: Record<string, unknown>) {
    return {
      clipKind: 'video',
      sink: {},
      speed: 1,
      frameRate: 30,
      sourceStartUs: 0,
      sourceRangeDurationUs: 20 * S,
      freezeFrameSourceUs: undefined,
      ...over,
    } as any;
  }

  describe('buildActiveClipWarmPlans (A)', () => {
    it('warms clips under the playhead and imminent upcoming clips, skipping distant and finished ones', () => {
      const compositor = new VideoCompositor() as any;
      const nowUs = 5 * S;
      compositor.clips = [
        videoClip({ itemId: 'past', startUs: 0, endUs: 4 * S }), // ended before now
        videoClip({ itemId: 'active', startUs: 3 * S, endUs: 10 * S }), // under playhead
        videoClip({ itemId: 'imminent', startUs: 5.5 * S, endUs: 12 * S }), // within 1s horizon
        videoClip({ itemId: 'far', startUs: 8 * S, endUs: 12 * S }), // beyond 1s horizon
      ];

      const plans = compositor.buildActiveClipWarmPlans(nowUs);
      const ids = plans.map((p: any) => p.clip.itemId).sort();

      expect(ids).toEqual(['active', 'imminent']);
    });

    it('warms an imminent clip from its first source frame at its own timeline start', () => {
      const compositor = new VideoCompositor() as any;
      const nowUs = 5 * S;
      compositor.clips = [videoClip({ itemId: 'imminent', startUs: 5.5 * S, endUs: 12 * S })];

      const plans = compositor.buildActiveClipWarmPlans(nowUs);
      expect(plans).toHaveLength(1);
      const plan = plans[0];
      // Not-yet-entered clip → warm from source time 0 (its first frame)…
      expect(plan.nowSourceTimeS).toBeCloseTo(0, 3);
      // …anchored at the clip's own timeline start (not the playhead).
      expect(plan.timelineNowUs).toBe(5.5 * S);
      // Head window extends forward past the start.
      expect(plan.aheadSourceTimeS).toBeGreaterThan(plan.nowSourceTimeS);
    });

    it('bounds the number of concurrent warm plans to MAX_PREWARM_CLIPS', () => {
      const compositor = new VideoCompositor() as any;
      const nowUs = 5 * S;
      // 12 short clips packed into the head horizon (dense cut cluster).
      compositor.clips = Array.from({ length: 12 }, (_, i) =>
        videoClip({ itemId: `c${i}`, startUs: 5 * S + i * 50_000, endUs: 12 * S }),
      );

      const plans = compositor.buildActiveClipWarmPlans(nowUs);
      expect(plans.length).toBeLessThanOrEqual(8);
    });
  });

  describe('maybeProactivePrewarmOnClipEntry (B)', () => {
    function compositorWithActive(clips: any[]) {
      const compositor = new VideoCompositor() as any;
      compositor.prewarmVideoFrames = vi.fn(() => Promise.resolve());
      compositor.activeTracker = { getActiveClips: () => clips };
      return compositor;
    }

    it('fires a prewarm when a new video clip enters while moving forward', () => {
      const clip = videoClip({ itemId: 'a', startUs: 0, endUs: 10 * S });
      const compositor = compositorWithActive([clip]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);

      expect(compositor.prewarmVideoFrames).toHaveBeenCalledTimes(1);
      expect(compositor.prewarmVideoFrames).toHaveBeenCalledWith(1 * S);
    });

    it('does not re-fire when the active set is unchanged across forward renders', () => {
      const clip = videoClip({ itemId: 'a', startUs: 0, endUs: 10 * S });
      const compositor = compositorWithActive([clip]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);
      compositor.maybeProactivePrewarmOnClipEntry(2 * S);

      expect(compositor.prewarmVideoFrames).toHaveBeenCalledTimes(1);
    });

    it('ignores clip entry when moving backward (scrub)', () => {
      const first = videoClip({ itemId: 'a', startUs: 0, endUs: 10 * S });
      const compositor = compositorWithActive([first]);
      compositor.maybeProactivePrewarmOnClipEntry(5 * S); // establish baseline (fires once)
      (compositor.prewarmVideoFrames as any).mockClear();

      // Jump backward into a different clip.
      compositor.activeTracker = {
        getActiveClips: () => [videoClip({ itemId: 'b', startUs: 0, endUs: 3 * S })],
      };
      compositor.maybeProactivePrewarmOnClipEntry(2 * S);

      expect(compositor.prewarmVideoFrames).not.toHaveBeenCalled();
    });

    it('does not fire for a freeze-frame clip entering', () => {
      const freeze = videoClip({ itemId: 'f', startUs: 0, endUs: 10 * S, freezeFrameSourceUs: 0 });
      const compositor = compositorWithActive([freeze]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);

      expect(compositor.prewarmVideoFrames).not.toHaveBeenCalled();
    });
  });
});
