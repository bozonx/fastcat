/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioScheduler } from '~/utils/video-editor/AudioScheduler';

interface MockCtx {
  currentTime: number;
  state: 'running' | 'suspended';
  resume: ReturnType<typeof vi.fn>;
}

function createMockCtx(currentTime = 0, state: 'running' | 'suspended' = 'running'): MockCtx {
  return {
    currentTime,
    state,
    resume: vi.fn(async () => {}),
  };
}

function createScheduler(options?: {
  ctx?: MockCtx | null;
  kickoffLatencyS?: number;
  onScheduleLookahead?: ReturnType<typeof vi.fn>;
  onStopNodes?: ReturnType<typeof vi.fn>;
}) {
  const onScheduleLookahead = options?.onScheduleLookahead ?? vi.fn();
  const onStopNodes = options?.onStopNodes ?? vi.fn();
  const ctxRef: { current: MockCtx | null } = { current: options?.ctx ?? null };

  const scheduler = new AudioScheduler({
    getContext: () => ctxRef.current as AudioContext | null,
    onScheduleLookahead,
    onStopNodes,
    kickoffLatencyS: options?.kickoffLatencyS,
  });

  return { scheduler, ctxRef, onScheduleLookahead, onStopNodes };
}

describe('AudioScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('play', () => {
    it('sets isPlaying and anchors baseTimeS', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(1_270_080_000_000, 1);

      expect(scheduler.isPlayingActive()).toBe(true);
      expect(scheduler.getBaseTimeS()).toBe(5);
    });

    it('sets playbackContextTimeS to ctx.currentTime + kickoffLatency', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.1 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(100.1, 5);
    });

    it('resumes suspended context', async () => {
      const ctx = createMockCtx(0, 'suspended');
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);

      expect(ctx.resume).toHaveBeenCalledTimes(1);
    });

    it('starts lookahead timer for positive speed', async () => {
      const onScheduleLookahead = vi.fn();
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, onScheduleLookahead });

      await scheduler.play(0, 1);

      // Immediate call + interval
      expect(onScheduleLookahead).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(onScheduleLookahead).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(50);
      expect(onScheduleLookahead).toHaveBeenCalledTimes(3);
    });

    it('does not start lookahead for zero speed', async () => {
      const onScheduleLookahead = vi.fn();
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, onScheduleLookahead });

      await scheduler.play(0, 0);

      expect(onScheduleLookahead).not.toHaveBeenCalled();
    });

    it('is a no-op when destroyed', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      scheduler.destroy();
      await scheduler.play(0, 1);

      expect(scheduler.isPlayingActive()).toBe(false);
    });

    it('uses wall-clock when ctx is null', async () => {
      const { scheduler } = createScheduler({ ctx: null });

      await scheduler.play(254_016_000_000, 1);

      expect(scheduler.isPlayingActive()).toBe(true);
      expect(scheduler.getBaseTimeS()).toBe(1);
      // playbackContextTimeS should be wallClock + kickoffLatency
      // Just verify it's a positive number
      expect(scheduler.getPlaybackStartCtxTimeS()).toBeGreaterThan(0);
    });
  });

  describe('stop', () => {
    it('stops playback and clears scheduled clips', async () => {
      const ctx = createMockCtx(0);
      const onStopNodes = vi.fn();
      const { scheduler } = createScheduler({ ctx, onStopNodes });

      await scheduler.play(0, 1);
      scheduler.markClipScheduled('clip-1');
      scheduler.stop();

      expect(scheduler.isPlayingActive()).toBe(false);
      expect(scheduler.hasScheduledClip('clip-1')).toBe(false);
      expect(onStopNodes).toHaveBeenCalledTimes(1);
    });

    it('stops the lookahead timer', async () => {
      const onScheduleLookahead = vi.fn();
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, onScheduleLookahead });

      await scheduler.play(0, 1);
      vi.advanceTimersByTime(50);
      const callsBeforeStop = onScheduleLookahead.mock.calls.length;

      scheduler.stop();
      vi.advanceTimersByTime(200);

      expect(onScheduleLookahead.mock.calls.length).toBe(callsBeforeStop);
    });
  });

  describe('seek', () => {
    it('reanchors baseTimeS and calls onStopNodes with fadeOut', async () => {
      const ctx = createMockCtx(50);
      const onStopNodes = vi.fn();
      const { scheduler } = createScheduler({ ctx, onStopNodes });

      await scheduler.play(0, 1);
      scheduler.seek(5_080_320_000_000);

      expect(scheduler.getBaseTimeS()).toBe(20);
      expect(onStopNodes).toHaveBeenCalledWith({ fadeOutS: 0.02 });
    });

    it('is a no-op when not playing', async () => {
      const onStopNodes = vi.fn();
      const { scheduler } = createScheduler({ ctx: createMockCtx(0), onStopNodes });

      scheduler.seek(10_000_000);

      expect(scheduler.getBaseTimeS()).toBe(0);
      expect(onStopNodes).not.toHaveBeenCalled();
    });

    it('is a no-op when destroyed', async () => {
      const ctx = createMockCtx(0);
      const onStopNodes = vi.fn();
      const { scheduler } = createScheduler({ ctx, onStopNodes });

      await scheduler.play(0, 1);
      scheduler.destroy();
      scheduler.seek(10_000_000);

      expect(scheduler.getBaseTimeS()).toBe(0);
    });

    it('uses wall-clock when ctx is null', async () => {
      const { scheduler } = createScheduler({ ctx: null });

      await scheduler.play(0, 1);
      scheduler.seek(3_810_240_000_000);

      expect(scheduler.getBaseTimeS()).toBe(15);
      expect(scheduler.getPlaybackStartCtxTimeS()).toBeGreaterThan(0);
    });

    it('triggers immediate lookahead for positive speed', async () => {
      const onScheduleLookahead = vi.fn();
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, onScheduleLookahead });

      await scheduler.play(0, 1);
      onScheduleLookahead.mockClear();
      scheduler.seek(1_270_080_000_000);

      expect(onScheduleLookahead).toHaveBeenCalledTimes(1);
    });
  });

  describe('setGlobalSpeed', () => {
    it('updates globalSpeed', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);
      scheduler.setGlobalSpeed(2);

      expect(scheduler.getGlobalSpeed()).toBe(2);
    });

    it('ignores NaN speed', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);
      scheduler.setGlobalSpeed(NaN);

      expect(scheduler.getGlobalSpeed()).toBe(1);
    });

    it('ignores Infinity speed', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);
      scheduler.setGlobalSpeed(Infinity);

      expect(scheduler.getGlobalSpeed()).toBe(1);
    });

    it('reanchors baseTimeS to current time when playing', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.05 });

      await scheduler.play(0, 1);
      // Advance ctx time
      ctx.currentTime = 105;
      scheduler.setGlobalSpeed(2);

      // baseTimeS should be updated to current time (5s elapsed at 1x speed)
      expect(scheduler.getBaseTimeS()).toBeCloseTo(5, 1);
    });

    it('does not reanchor when not playing', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      scheduler.setGlobalSpeed(3);

      expect(scheduler.getGlobalSpeed()).toBe(3);
      expect(scheduler.getBaseTimeS()).toBe(0);
    });

    it('calls onStopNodes with fadeOut when playing', async () => {
      const ctx = createMockCtx(0);
      const onStopNodes = vi.fn();
      const { scheduler } = createScheduler({ ctx, onStopNodes });

      await scheduler.play(0, 1);
      onStopNodes.mockClear();
      scheduler.setGlobalSpeed(2);

      expect(onStopNodes).toHaveBeenCalledWith({ fadeOutS: 0.02 });
    });

    it('uses wall-clock when ctx is null', async () => {
      const { scheduler } = createScheduler({ ctx: null });

      await scheduler.play(0, 1);
      scheduler.setGlobalSpeed(2);

      expect(scheduler.getGlobalSpeed()).toBe(2);
      expect(scheduler.getPlaybackStartCtxTimeS()).toBeGreaterThan(0);
    });
  });

  describe('setGlobalSpeed transport continuity', () => {
    it('preserves getCurrentTimeS across speed change when ctx has not advanced', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.05 });

      await scheduler.play(0, 1);
      // Advance ctx time by 5 seconds (at 1x speed → currentTimeS ≈ 5)
      ctx.currentTime = 105;
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(5, 1);

      // Change speed — transport position must not jump
      scheduler.setGlobalSpeed(3);
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(5, 1);

      // Advance ctx well past the kickoff latency so elapsed is clean.
      // After setGlobalSpeed, playbackContextTimeS = 105 + 0.05 = 105.05.
      // At ctx=110: elapsed = 110 - 105.05 = 4.95, × 3 = 14.85 → 5 + 14.85 = 19.85
      ctx.currentTime = 110;
      const expected = 5 + (110 - 105.05) * 3;
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(expected, 1);
    });

    it('preserves getCurrentTimeS when speed changes to fractional value', async () => {
      const ctx = createMockCtx(50);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.05 });

      await scheduler.play(2_540_160_000_000, 1);
      // Advance 2 seconds at 1x → timeline at 12s
      ctx.currentTime = 52;
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(12, 1);

      scheduler.setGlobalSpeed(0.5);
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(12, 1);

      // After setGlobalSpeed, playbackContextTimeS = 52 + 0.05 = 52.05.
      // Advance to 54: elapsed = 54 - 52.05 = 1.95, × 0.5 = 0.975 → 12 + 0.975 = 12.975
      ctx.currentTime = 54;
      const expected = 12 + (54 - 52.05) * 0.5;
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(expected, 1);
    });

    it('negative speed is stored as-is (sanitized on native side)', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);
      scheduler.setGlobalSpeed(-2);

      // The scheduler stores the value; native Rust sanitize_speed clamps it.
      // getCurrentTimeS with negative speed returns baseTimeS (no advancement).
      expect(scheduler.getGlobalSpeed()).toBe(-2);
      expect(scheduler.getCurrentTimeS()).toBe(0);
    });
  });

  describe('syncTime', () => {
    it('reanchors baseTimeS when playing', async () => {
      const ctx = createMockCtx(50);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);
      scheduler.syncTime(3_134_557_440_000);

      expect(scheduler.getBaseTimeS()).toBeCloseTo(12.34, 5);
    });

    it('is a no-op when not playing', () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      scheduler.syncTime(5_000_000);

      expect(scheduler.getBaseTimeS()).toBe(0);
    });

    it('uses wall-clock when ctx is null', async () => {
      const { scheduler } = createScheduler({ ctx: null });

      await scheduler.play(0, 1);
      scheduler.syncTime(1_778_112_000_000);

      expect(scheduler.getBaseTimeS()).toBeCloseTo(7, 5);
    });
  });

  describe('getCurrentTimeS', () => {
    it('returns baseTimeS when not playing', () => {
      const { scheduler } = createScheduler({ ctx: createMockCtx(100) });
      expect(scheduler.getCurrentTimeS()).toBe(0);
    });

    it('returns baseTimeS before kickoff is reached', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.1 });

      await scheduler.play(508_032_000_000, 1);
      // ctx.currentTime is still 100, kickoff is 100.1
      // elapsed = max(0, 100 - 100.1) = 0
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(2, 5);
    });

    it('advances after kickoff is reached', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.1 });

      await scheduler.play(508_032_000_000, 1);
      ctx.currentTime = 100.6;
      // elapsed = 100.6 - 100.1 = 0.5
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(2.5, 5);
    });

    it('scales elapsed by globalSpeed', async () => {
      const ctx = createMockCtx(100);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.1 });

      await scheduler.play(0, 2);
      ctx.currentTime = 100.6;
      // elapsed = 0.5, speed=2 → 1.0
      expect(scheduler.getCurrentTimeS()).toBeCloseTo(1.0, 5);
    });

    it('uses wall-clock when ctx is null', async () => {
      const { scheduler } = createScheduler({ ctx: null });

      await scheduler.play(0, 1);
      // Wall clock is advancing — just verify it returns a number
      const t = scheduler.getCurrentTimeS();
      expect(typeof t).toBe('number');
    });
  });

  describe('scheduled clips tracking', () => {
    it('marks and checks scheduled clips', () => {
      const { scheduler } = createScheduler({ ctx: createMockCtx(0) });
      scheduler.markClipScheduled('clip-a');
      expect(scheduler.hasScheduledClip('clip-a')).toBe(true);
      expect(scheduler.hasScheduledClip('clip-b')).toBe(false);
    });

    it('resets scheduled clips', () => {
      const { scheduler } = createScheduler({ ctx: createMockCtx(0) });
      scheduler.markClipScheduled('clip-a');
      scheduler.resetScheduledClips();
      expect(scheduler.hasScheduledClip('clip-a')).toBe(false);
    });

    it('clears scheduled clips on play', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });
      scheduler.markClipScheduled('old-clip');
      await scheduler.play(0, 1);
      expect(scheduler.hasScheduledClip('old-clip')).toBe(false);
    });

    it('clears scheduled clips on stop', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });
      await scheduler.play(0, 1);
      scheduler.markClipScheduled('clip-1');
      scheduler.stop();
      expect(scheduler.hasScheduledClip('clip-1')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('stops playback and lookahead', async () => {
      const onScheduleLookahead = vi.fn();
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, onScheduleLookahead });

      await scheduler.play(0, 1);
      vi.advanceTimersByTime(50);
      const callsBeforeDestroy = onScheduleLookahead.mock.calls.length;

      scheduler.destroy();
      vi.advanceTimersByTime(200);

      expect(scheduler.isPlayingActive()).toBe(false);
      expect(onScheduleLookahead.mock.calls.length).toBe(callsBeforeDestroy);
    });

    it('is safe to call twice', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      scheduler.destroy();
      expect(() => scheduler.destroy()).not.toThrow();
    });

    it('play after destroy is a no-op', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      scheduler.destroy();
      await scheduler.play(0, 1);

      expect(scheduler.isPlayingActive()).toBe(false);
    });
  });

  describe('kickoffLatencyS normalization', () => {
    it('uses default 0.05 when not specified', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.05, 5);
    });

    it('uses default when NaN', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: NaN });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.05, 5);
    });

    it('uses default when 0', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.05, 5);
    });

    it('uses default when negative', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: -1 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.05, 5);
    });

    it('clamps to minimum 0.03', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.01 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.03, 5);
    });

    it('clamps to maximum 0.15', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 1.0 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.15, 5);
    });

    it('uses provided value within range', async () => {
      const ctx = createMockCtx(0);
      const { scheduler } = createScheduler({ ctx, kickoffLatencyS: 0.08 });

      await scheduler.play(0, 1);

      expect(scheduler.getPlaybackStartCtxTimeS()).toBeCloseTo(0.08, 5);
    });
  });
});
