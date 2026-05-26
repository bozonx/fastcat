/** @vitest-environment node */
import { describe, it, expect } from 'vitest';

import {
  frameToUs,
  usToFrame,
  quantizeTimeUsToFrames,
  sanitizeFps,
} from '~/timeline/commands/utils';
import { formatTimecode } from '~/utils/timecode';
import { sanitizeFps as sanitizeMonitorFps } from '~/utils/monitor-time';
import { buildMonitorTimecodeText } from '~/composables/monitor/useMonitorPlayback';

/**
 * These tests pin down the timeline's time-accuracy guarantees so regressions
 * that would make errors accumulate over the length of the timeline / playback
 * duration are caught. They cover both integer and NTSC (non-integer) fps.
 */

// Common project rates, integer and NTSC.
const FPS_CASES = [24, 25, 30, 50, 60, 23.976, 29.97, 59.94] as const;

describe('frame quantization is drift-free', () => {
  it('is idempotent: re-quantizing a quantized time never moves it', () => {
    for (const fps of FPS_CASES) {
      for (let i = 0; i < 500; i++) {
        const t = Math.round((i / 500) * 60_000_000); // 0 .. 60s, deterministic
        const once = quantizeTimeUsToFrames(t, fps, 'round');
        const twice = quantizeTimeUsToFrames(once, fps, 'round');
        expect(twice).toBe(once);
      }
    }
  });

  it('frameToUs/usToFrame round-trip is stable for every frame index', () => {
    // Collect the first mismatch instead of asserting per-iteration to keep the
    // sweep fast; the message pinpoints the failing (fps, frame) on regression.
    let firstMismatch: { fps: number; frame: number; got: number } | null = null;
    for (const fps of FPS_CASES) {
      for (let frame = 0; frame <= 20_000 && !firstMismatch; frame++) {
        const got = usToFrame(frameToUs(frame, fps), fps, 'round');
        if (got !== frame) firstMismatch = { fps, frame, got };
      }
    }
    expect(firstMismatch).toBeNull();
  });

  it('stepping one frame at a time never accumulates error over a long timeline', () => {
    // Mirrors seekFrames(): currentTime advances by a fractional frame interval
    // and is re-quantized (round) on every step, exactly like setCurrentTimeUs.
    // After N steps the playhead must sit precisely on frame N — no drift.
    let firstDrift: { fps: number; step: number; got: number; want: number } | null = null;
    for (const fps of FPS_CASES) {
      const frameUs = 1_000_000 / sanitizeFps(fps);
      let t = 0;
      for (let k = 1; k <= 30_000 && !firstDrift; k++) {
        t = quantizeTimeUsToFrames(t + frameUs, fps, 'round');
        const want = frameToUs(k, fps);
        if (t !== want) firstDrift = { fps, step: k, got: t, want };
      }
    }
    expect(firstDrift).toBeNull();
  });

  it('stepping backward also lands exactly on frame boundaries', () => {
    let firstDrift: { fps: number; step: number; got: number; want: number } | null = null;
    for (const fps of FPS_CASES) {
      const frameUs = 1_000_000 / sanitizeFps(fps);
      let t = frameToUs(30_000, fps);
      for (let k = 29_999; k >= 0 && !firstDrift; k--) {
        t = quantizeTimeUsToFrames(t - frameUs, fps, 'round');
        const want = frameToUs(k, fps);
        if (t !== want) firstDrift = { fps, step: k, got: t, want };
      }
    }
    expect(firstDrift).toBeNull();
  });
});

describe('monitor and ruler share one fps source of truth', () => {
  it('sanitizeFps preserves NTSC rates so the monitor matches the ruler', () => {
    // The ruler formats with the real fps from the timeline format (quantized to
    // 3 decimals); the monitor must sanitize to the same value, not an integer.
    expect(sanitizeMonitorFps(29.97)).toBe(sanitizeFps(29.97));
    expect(sanitizeMonitorFps(23.976)).toBe(sanitizeFps(23.976));
    expect(sanitizeMonitorFps(59.94)).toBe(sanitizeFps(59.94));
  });

  it('monitor timecode equals ruler timecode for NTSC across the timeline', () => {
    const rawFps = 29.97;
    const fps = sanitizeMonitorFps(rawFps); // what the monitor passes to formatTimecode
    const durationUs = 600_000_000; // 10 min
    for (let s = 0; s <= 600; s += 7) {
      const us = s * 1_000_000 + 12_345; // off-grid sample
      const rulerText = formatTimecode(us, fps); // ruler path
      const monitorCurrent = buildMonitorTimecodeText({
        currentTimeUs: us,
        durationUs,
        fps,
      }).split(' / ')[0];
      expect(monitorCurrent).toBe(rulerText);
    }
  });
});

describe('formatTimecode tracks real time for non-integer fps', () => {
  it('formats NTSC rates against the real fps (consistent with frame math)', () => {
    expect(formatTimecode(0, 29.97)).toBe('00:00:00:00');
    expect(formatTimecode(frameToUs(1, 29.97), 29.97)).toBe('00:00:00:01');
    expect(formatTimecode(1_000_000, 29.97)).toBe('00:00:01:00');
    expect(formatTimecode(1_000_000, 23.976)).toBe('00:00:01:00');
  });

  it('the frame sub-field stays within [0, ceil(fps) - 1]', () => {
    let outOfRange: { fps: number; frame: number; ff: number } | null = null;
    for (const fps of FPS_CASES) {
      const maxFrameField = Math.ceil(fps) - 1;
      for (let frame = 0; frame <= 10_000 && !outOfRange; frame++) {
        const ff = Number(formatTimecode(frameToUs(frame, fps), fps).split(':')[3]);
        if (ff < 0 || ff > maxFrameField) outOfRange = { fps, frame, ff };
      }
    }
    expect(outOfRange).toBeNull();
  });
});
