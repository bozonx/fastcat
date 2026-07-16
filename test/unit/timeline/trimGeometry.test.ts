/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { computeTrimGeometry } from '~/timeline/commands/item/trimGeometry';

describe('computeTrimGeometry', () => {
  const fps = 25; // 1 frame = 40,000 Us
  const frameTicks = 10_160_640_000;

  it('performs basic end edge trimming at normal speed (1.0) without quantization', () => {
    const result = computeTrimGeometry({
      edge: 'end',
      deltaTicks: 25_401_600_000, // +100ms
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 }, // 400ms (10 frames)
      sourceRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startTicks: 0, durationTicks: 127_008_000_000 });
    expect(result.sourceRange).toEqual({ startTicks: 0, durationTicks: 127_008_000_000 });
  });

  it('performs basic start edge trimming at normal speed (1.0) without quantization', () => {
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: 20_321_280_000, // +80ms (shrinking from start)
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({
      startTicks: 20_321_280_000,
      durationTicks: 81_285_120_000,
    });
    expect(result.sourceRange).toEqual({
      startTicks: 20_321_280_000,
      durationTicks: 81_285_120_000,
    });
  });

  it('clamps to source boundaries when extending past limits (fixed duration)', () => {
    const result = computeTrimGeometry({
      edge: 'end',
      deltaTicks: 203_212_800_000, // extending by +800ms
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceDurationTicks: 152_409_600_000, // source limit is 600ms, can only extend by 200ms
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({ startTicks: 0, durationTicks: 152_409_600_000 });
    expect(result.sourceRange).toEqual({ startTicks: 0, durationTicks: 152_409_600_000 });
  });

  it('applies frame quantization on timeline and matches source range at fractional speed (1.25)', () => {
    // 1 frame timeline = 40,000 Us.
    // At speed 1.25, 1 frame timeline = 50,000 Us source.
    const result = computeTrimGeometry({
      edge: 'end',
      deltaTicks: 12_700_800_000, // +50ms. Quantized to nearest frame (+1 frame = +40ms)
      speed: 1.25,
      fps,
      quantizeToFrames: true,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 }, // 10 frames
      sourceRange: { startTicks: 0, durationTicks: 127_008_000_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    // deltaTicks (+50ms) rounds to 1 frame (+40ms) on timeline.
    expect(result.timelineRange).toEqual({ startTicks: 0, durationTicks: 111_767_040_000 }); // 11 frames
    // sourceDeltaTicks = 40ms * 1.25 = 50ms.
    expect(result.sourceRange).toEqual({ startTicks: 0, durationTicks: 139_708_800_000 });
  });

  it('correctly compensates quantization offset on both start and end source boundaries', () => {
    // Trimming the start edge by deltaTicks = 30000 Us (non-frame-aligned).
    // Timeline FPS is 25 (frame = 40000 Us).
    // Speed is 1.5. 1 frame timeline = 60000 Us source.
    // Raw start shifts to 30000, raw duration becomes 370000.
    // Quantized start shifts to 40000 (1 frame), quantized duration becomes 360000 (9 frames).
    // Quantization offset of start: deltaLeftTicks = +10,000 Us.
    // Quantization offset of end: deltaRightTicks = 0 (both raw end 400k and qEnd 400k match).
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: 7_620_480_000,
      speed: 1.5,
      fps,
      quantizeToFrames: true,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 }, // 10 frames
      sourceRange: { startTicks: 0, durationTicks: 152_409_600_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({
      startTicks: 10_160_640_000,
      durationTicks: 91_445_760_000,
    });
    // Left boundary moves: prevSourceStart (0) + appliedDelta (30000 * 1.5 = 45000) + deltaLeftTicks * 1.5 (10000 * 1.5 = 15000) = 60000.
    // Right boundary should remain unchanged at 600000 because end didn't shift.
    expect(result.sourceRange).toEqual({
      startTicks: 15_240_960_000,
      durationTicks: 137_168_640_000,
    });
    // Invariant: source duration 540,000 Us / speed 1.5 = timeline duration 360,000 Us.
    expect(result.sourceRange.durationTicks).toBe(
      Math.round(result.timelineRange.durationTicks * 1.5),
    );
  });

  it('correctly handles start edge trimming with fractional speed (0.8) and non-aligned frames', () => {
    // Speed = 0.8.
    // Trimming start edge by +70,000 Us.
    // Without quantization, timeline start would be 70,000 Us, timeline duration 330,000 Us.
    // Quantized start shifts to 80,000 Us (2 frames). Quantized duration becomes 320,000 Us (8 frames).
    // deltaLeftTicks = +10,000 Us.
    // deltaRightTicks = 0 (both raw end 400k and qEnd 400k match).
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: 17_781_120_000,
      speed: 0.8,
      fps,
      quantizeToFrames: true,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 0, durationTicks: 81_285_120_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({
      startTicks: 20_321_280_000,
      durationTicks: 81_285_120_000,
    });
    // Left source moves by quantized start 80,000 * 0.8 = 64,000 Us.
    // Right source remains 320,000 Us.
    expect(result.sourceRange).toEqual({
      startTicks: 16_257_024_000,
      durationTicks: 65_028_096_000,
    });
    // Invariant: source duration 256,000 Us / speed 0.8 = timeline duration 320,000 Us.
    expect(result.sourceRange.durationTicks).toBe(
      Math.round(result.timelineRange.durationTicks * 0.8),
    );
  });

  it('supports reverse playback speeds (speed < 0) under quantization', () => {
    // Reverse speed: -1.0. Start of timeline corresponds to end of source.
    // Trimming the start edge of the timeline (moving start to the right) moves the END of the source range to the left.
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: 10_160_640_000, // +1 frame timeline
      speed: -1.0,
      fps,
      quantizeToFrames: true,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 25_401_600_000, durationTicks: 101_606_400_000 }, // Source end was 500k
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({
      startTicks: 10_160_640_000,
      durationTicks: 91_445_760_000,
    });
    // Source end moves left by 40,000 Us: from 500,000 Us to 460,000 Us.
    // Source start remains 100,000 Us.
    expect(result.sourceRange).toEqual({
      startTicks: 25_401_600_000,
      durationTicks: 91_445_760_000,
    });
  });

  it('rejects trims that shrink the clip below one frame', () => {
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: 99_066_240_000, // leaving only 10ms (less than 40ms frame)
      speed: 1.0,
      fps,
      quantizeToFrames: true,
      timelineRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceDurationTicks: 254_016_000_000,
      hasFixedSourceDuration: true,
    });

    expect(result.valid).toBe(false);
  });

  it('keeps static clip source start non-negative when extending the start left', () => {
    const result = computeTrimGeometry({
      edge: 'start',
      deltaTicks: -50_803_200_000,
      speed: 1.0,
      fps,
      quantizeToFrames: false,
      timelineRange: { startTicks: 127_008_000_000, durationTicks: 101_606_400_000 },
      sourceRange: { startTicks: 0, durationTicks: 101_606_400_000 },
      sourceDurationTicks: 101_606_400_000,
      hasFixedSourceDuration: false,
    });

    expect(result.valid).toBe(true);
    expect(result.timelineRange).toEqual({
      startTicks: 76_204_800_000,
      durationTicks: 152_409_600_000,
    });
    expect(result.sourceRange).toEqual({ startTicks: 0, durationTicks: 152_409_600_000 });
  });
});
