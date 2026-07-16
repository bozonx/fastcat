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
      sourceStartTicks: 0,
      sourceRangeDurationTicks: 20 * S,
      freezeFrameSourceTicks: undefined,
      ...over,
    } as any;
  }

  describe('buildActiveClipWarmPlans (A)', () => {
    it('warms clips under the playhead and imminent upcoming clips, skipping distant and finished ones', () => {
      const compositor = new VideoCompositor() as any;
      const nowTicks = 5 * S;
      compositor.clips = [
        videoClip({ itemId: 'past', startTicks: 0, endTicks: 4 * S }), // ended before now
        videoClip({ itemId: 'active', startTicks: 3 * S, endTicks: 10 * S }), // under playhead
        videoClip({ itemId: 'imminent', startTicks: 5.5 * S, endTicks: 12 * S }), // within 1s horizon
        videoClip({ itemId: 'far', startTicks: 8 * S, endTicks: 12 * S }), // beyond 1s horizon
      ];

      const plans = compositor.buildActiveClipWarmPlans(nowTicks);
      const ids = plans.map((p: any) => p.clip.itemId).sort();

      expect(ids).toEqual(['active', 'imminent']);
    });

    it('warms an imminent clip from its first source frame at its own timeline start', () => {
      const compositor = new VideoCompositor() as any;
      const nowTicks = 5 * S;
      compositor.clips = [videoClip({ itemId: 'imminent', startTicks: 5.5 * S, endTicks: 12 * S })];

      const plans = compositor.buildActiveClipWarmPlans(nowTicks);
      expect(plans).toHaveLength(1);
      const plan = plans[0];
      // Not-yet-entered clip → warm from source time 0 (its first frame)…
      expect(plan.nowSourceTimeS).toBeCloseTo(0, 3);
      // …anchored at the clip's own timeline start (not the playhead).
      expect(plan.timelineNowTicks).toBe(5.5 * S);
      // Head window extends forward past the start.
      expect(plan.aheadSourceTimeS).toBeGreaterThan(plan.nowSourceTimeS);
    });

    it('bounds the number of concurrent warm plans to MAX_PREWARM_CLIPS', () => {
      const compositor = new VideoCompositor() as any;
      const nowTicks = 5 * S;
      // 12 short clips packed into the head horizon (dense cut cluster).
      compositor.clips = Array.from({ length: 12 }, (_, i) =>
        videoClip({ itemId: `c${i}`, startTicks: 5 * S + i * 50_000, endTicks: 12 * S }),
      );

      const plans = compositor.buildActiveClipWarmPlans(nowTicks);
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
      const clip = videoClip({ itemId: 'a', startTicks: 0, endTicks: 10 * S });
      const compositor = compositorWithActive([clip]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);

      expect(compositor.prewarmVideoFrames).toHaveBeenCalledTimes(1);
      expect(compositor.prewarmVideoFrames).toHaveBeenCalledWith(1 * S);
    });

    it('does not re-fire when the active set is unchanged across forward renders', () => {
      const clip = videoClip({ itemId: 'a', startTicks: 0, endTicks: 10 * S });
      const compositor = compositorWithActive([clip]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);
      compositor.maybeProactivePrewarmOnClipEntry(2 * S);

      expect(compositor.prewarmVideoFrames).toHaveBeenCalledTimes(1);
    });

    it('ignores clip entry when moving backward (scrub)', () => {
      const first = videoClip({ itemId: 'a', startTicks: 0, endTicks: 10 * S });
      const compositor = compositorWithActive([first]);
      compositor.maybeProactivePrewarmOnClipEntry(5 * S); // establish baseline (fires once)
      (compositor.prewarmVideoFrames as any).mockClear();

      // Jump backward into a different clip.
      compositor.activeTracker = {
        getActiveClips: () => [videoClip({ itemId: 'b', startTicks: 0, endTicks: 3 * S })],
      };
      compositor.maybeProactivePrewarmOnClipEntry(2 * S);

      expect(compositor.prewarmVideoFrames).not.toHaveBeenCalled();
    });

    it('does not fire for a freeze-frame clip entering', () => {
      const freeze = videoClip({
        itemId: 'f',
        startTicks: 0,
        endTicks: 10 * S,
        freezeFrameSourceTicks: 0,
      });
      const compositor = compositorWithActive([freeze]);

      compositor.maybeProactivePrewarmOnClipEntry(1 * S);

      expect(compositor.prewarmVideoFrames).not.toHaveBeenCalled();
    });
  });
});
