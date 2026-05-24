/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { computeTrimGeometry } from '~/timeline/commands/item/trimGeometry';

describe('computeTrimGeometry', () => {
  const fps = 25; // 1 frame = 40,000 Us
  const frameUs = 40000;

  it('performs basic end edge trimming at normal speed (1.0) without quantization', () => {
    const result = computeTrimGeometry({
      edge: 'end',
      deltaUs: 100000, // +100ms
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startUs: 0, durationUs: 400000 }, // 400ms (10 frames)
      sourceRange: { startUs: 0, durationUs: 400000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 0, durationUs: 500000 });
    expect(result.sourceRange).toEqual({ startUs: 0, durationUs: 500000 });
  });

  it('performs basic start edge trimming at normal speed (1.0) without quantization', () => {
    const result = computeTrimGeometry({
      edge: 'start',
      deltaUs: 80000, // +80ms (shrinking from start)
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startUs: 0, durationUs: 400000 },
      sourceRange: { startUs: 0, durationUs: 400000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 80000, durationUs: 320000 });
    expect(result.sourceRange).toEqual({ startUs: 80000, durationUs: 320000 });
  });

  it('clamps to source boundaries when extending past limits (fixed duration)', () => {
    const result = computeTrimGeometry({
      edge: 'end',
      deltaUs: 800000, // extending by +800ms
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startUs: 0, durationUs: 400000 },
      sourceRange: { startUs: 0, durationUs: 400000 },
      sourceDurationUs: 600000, // source limit is 600ms, can only extend by 200ms
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 0, durationUs: 600000 });
    expect(result.sourceRange).toEqual({ startUs: 0, durationUs: 600000 });
  });

  it('applies frame quantization on timeline and matches source range at fractional speed (1.25)', () => {
    // 1 frame timeline = 40,000 Us.
    // At speed 1.25, 1 frame timeline = 50,000 Us source.
    const result = computeTrimGeometry({
      edge: 'end',
      deltaUs: 50000, // +50ms. Quantized to nearest frame (+1 frame = +40ms)
      speed: 1.25,
      fps,
      quantizeToFrames: true,
      timelineRange: { startUs: 0, durationUs: 400000 }, // 10 frames
      sourceRange: { startUs: 0, durationUs: 500000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    // deltaUs (+50ms) rounds to 1 frame (+40ms) on timeline.
    expect(result.timelineRange).toEqual({ startUs: 0, durationUs: 440000 }); // 11 frames
    // sourceDeltaUs = 40ms * 1.25 = 50ms.
    expect(result.sourceRange).toEqual({ startUs: 0, durationUs: 550000 });
  });

  it('correctly compensates quantization offset on both start and end source boundaries', () => {
    // Trimming the start edge by deltaUs = 30000 Us (non-frame-aligned).
    // Timeline FPS is 25 (frame = 40000 Us).
    // Speed is 1.5. 1 frame timeline = 60000 Us source.
    // Raw start shifts to 30000, raw duration becomes 370000.
    // Quantized start shifts to 40000 (1 frame), quantized duration becomes 360000 (9 frames).
    // Quantization offset of start: deltaLeftUs = +10,000 Us.
    // Quantization offset of end: deltaRightUs = 0 (both raw end 400k and qEnd 400k match).
    const result = computeTrimGeometry({
      edge: 'start',
      deltaUs: 30000,
      speed: 1.5,
      fps,
      quantizeToFrames: true,
      timelineRange: { startUs: 0, durationUs: 400000 }, // 10 frames
      sourceRange: { startUs: 0, durationUs: 600000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 40000, durationUs: 360000 });
    // Left boundary moves: prevSourceStart (0) + appliedDelta (30000 * 1.5 = 45000) + deltaLeftUs * 1.5 (10000 * 1.5 = 15000) = 60000.
    // Right boundary should remain unchanged at 600000 because end didn't shift.
    expect(result.sourceRange).toEqual({ startUs: 60000, durationUs: 540000 });
    // Invariant: source duration 540,000 Us / speed 1.5 = timeline duration 360,000 Us.
    expect(result.sourceRange.durationUs).toBe(Math.round(result.timelineRange.durationUs * 1.5));
  });

  it('correctly handles start edge trimming with fractional speed (0.8) and non-aligned frames', () => {
    // Speed = 0.8.
    // Trimming start edge by +70,000 Us.
    // Without quantization, timeline start would be 70,000 Us, timeline duration 330,000 Us.
    // Quantized start shifts to 80,000 Us (2 frames). Quantized duration becomes 320,000 Us (8 frames).
    // deltaLeftUs = +10,000 Us.
    // deltaRightUs = 0 (both raw end 400k and qEnd 400k match).
    const result = computeTrimGeometry({
      edge: 'start',
      deltaUs: 70000,
      speed: 0.8,
      fps,
      quantizeToFrames: true,
      timelineRange: { startUs: 0, durationUs: 400000 },
      sourceRange: { startUs: 0, durationUs: 320000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 80000, durationUs: 320000 });
    // Left source moves by quantized start 80,000 * 0.8 = 64,000 Us.
    // Right source remains 320,000 Us.
    expect(result.sourceRange).toEqual({ startUs: 64000, durationUs: 256000 });
    // Invariant: source duration 256,000 Us / speed 0.8 = timeline duration 320,000 Us.
    expect(result.sourceRange.durationUs).toBe(Math.round(result.timelineRange.durationUs * 0.8));
  });

  it('supports reverse playback speeds (speed < 0) under quantization', () => {
    // Reverse speed: -1.0. Start of timeline corresponds to end of source.
    // Trimming the start edge of the timeline (moving start to the right) moves the END of the source range to the left.
    const result = computeTrimGeometry({
      edge: 'start',
      deltaUs: 40000, // +1 frame timeline
      speed: -1.0,
      fps,
      quantizeToFrames: true,
      timelineRange: { startUs: 0, durationUs: 400000 },
      sourceRange: { startUs: 100000, durationUs: 400000 }, // Source end was 500k
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startUs: 40000, durationUs: 360000 });
    // Source end moves left by 40,000 Us: from 500,000 Us to 460,000 Us.
    // Source start remains 100,000 Us.
    expect(result.sourceRange).toEqual({ startUs: 100000, durationUs: 360000 });
  });

  it('rejects trims that shrink the clip below one frame', () => {
    const result = computeTrimGeometry({
      edge: 'start',
      deltaUs: 390000, // leaving only 10ms (less than 40ms frame)
      speed: 1.0,
      fps,
      quantizeToFrames: true,
      timelineRange: { startUs: 0, durationUs: 400000 },
      sourceRange: { startUs: 0, durationUs: 400000 },
      sourceDurationUs: 1000000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(false);
  });
});
