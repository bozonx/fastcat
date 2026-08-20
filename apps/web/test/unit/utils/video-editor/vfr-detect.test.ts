/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  checkFrameIntervalUniformity,
  FRAME_INTERVAL_CHECK_MIN_SAMPLES,
} from '~/utils/video-editor/vfr-detect';

describe('checkFrameIntervalUniformity', () => {
  it('returns null when there are too few samples to judge', () => {
    const timestamps = Array.from(
      { length: FRAME_INTERVAL_CHECK_MIN_SAMPLES - 1 },
      (_, i) => i / 30,
    );
    expect(checkFrameIntervalUniformity(timestamps, 30)).toBeNull();
  });

  it('returns null for a non-finite or non-positive nominal fps', () => {
    const timestamps = Array.from({ length: 30 }, (_, i) => i / 30);
    expect(checkFrameIntervalUniformity(timestamps, 0)).toBeNull();
    expect(checkFrameIntervalUniformity(timestamps, NaN)).toBeNull();
    expect(checkFrameIntervalUniformity(timestamps, -30)).toBeNull();
  });

  it('returns true for a dense uniform-interval (CFR) stream', () => {
    const timestamps = Array.from({ length: 60 }, (_, i) => i / 30);
    expect(checkFrameIntervalUniformity(timestamps, 30)).toBe(true);
  });

  it('does not require pre-sorted input (decode-order B-frame reordering)', () => {
    const sorted = Array.from({ length: 60 }, (_, i) => i / 30);
    // Shuffle a decode-order-like jumble: swap adjacent pairs.
    const jumbled = [...sorted];
    for (let i = 0; i + 1 < jumbled.length; i += 2) {
      [jumbled[i], jumbled[i + 1]] = [jumbled[i + 1]!, jumbled[i]!];
    }
    expect(checkFrameIntervalUniformity(jumbled, 30)).toBe(true);
  });

  it('returns false for a dense jittery-interval (VFR) stream', () => {
    const gaps = [0.02, 0.047];
    let t = 0;
    const timestamps: number[] = [];
    for (let i = 0; i < 40; i++) {
      timestamps.push(t);
      t += gaps[i % 2]!;
    }
    // Average interval ~0.0335s -> ~29.85fps, close to 30 but individual gaps jitter.
    expect(checkFrameIntervalUniformity(timestamps, 30)).toBe(false);
  });

  it('tolerates small container/timebase rounding noise', () => {
    const timestamps = Array.from(
      { length: 40 },
      (_, i) => i / 30 + (i % 2 === 0 ? 0.0001 : -0.0001),
    );
    expect(checkFrameIntervalUniformity(timestamps, 30)).toBe(true);
  });
});
