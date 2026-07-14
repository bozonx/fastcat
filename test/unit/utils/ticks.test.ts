/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_TICKS_PER_SECOND,
  MAX_SAFE_TICKS,
  STANDARD_AUDIO_SAMPLE_RATES,
  STANDARD_FRAME_RATES,
  TICKS_PER_SECOND,
  TICKS_PER_MICROSECOND,
  formatTicksAsTimecode,
  framesToTicks,
  isTickRateFrameCompatible,
  isTickRateSampleCompatible,
  parseTimecodeToTicks,
  quantizeTicksToFrame,
  sanitizeFrameRate,
  secondsToTicks,
  ticksPerFrame,
  ticksToFrames,
  ticksToSeconds,
} from '~/utils/time/ticks';

describe('tick conversions', () => {
  it('uses the canonical tick rate while retaining exact integer conversions', () => {
    expect(TICKS_PER_SECOND).toBe(CANONICAL_TICKS_PER_SECOND);
    expect(TICKS_PER_SECOND).toBe(254_016_000_000);
    expect(ticksToSeconds(TICKS_PER_SECOND / 2)).toBe(0.5);
    expect(secondsToTicks({ seconds: 0.5 })).toBe(TICKS_PER_SECOND / 2);
    expect(secondsToTicks({ seconds: -0.000_000_5, mode: 'floor' })).toBe(
      -TICKS_PER_MICROSECOND / 2,
    );
  });

  it('quantizes frame conversions with the requested rounding mode', () => {
    const frameRate = { num: 30, den: 1 };

    expect(ticksToFrames({ ticks: TICKS_PER_SECOND + 1, frameRate, mode: 'floor' })).toBe(30);
    expect(ticksToFrames({ ticks: TICKS_PER_SECOND + 1, frameRate, mode: 'ceil' })).toBe(31);
    expect(framesToTicks({ frames: 30, frameRate })).toBe(TICKS_PER_SECOND);
    expect(quantizeTicksToFrame({ ticks: TICKS_PER_SECOND + 1, frameRate })).toBe(TICKS_PER_SECOND);
  });
});

describe('canonical tick-rate compatibility', () => {
  it('has an integral tick count for every standard video frame and audio sample', () => {
    for (const frameRate of STANDARD_FRAME_RATES) {
      expect(
        isTickRateFrameCompatible({ ticksPerSecond: CANONICAL_TICKS_PER_SECOND, frameRate }),
      ).toBe(true);
    }

    for (const sampleRate of STANDARD_AUDIO_SAMPLE_RATES) {
      expect(
        isTickRateSampleCompatible({ ticksPerSecond: CANONICAL_TICKS_PER_SECOND, sampleRate }),
      ).toBe(true);
    }
  });

  it('represents an NTSC frame as an exact integer tick count', () => {
    expect(
      ticksPerFrame({
        ticksPerSecond: CANONICAL_TICKS_PER_SECOND,
        frameRate: { num: 30_000, den: 1_001 },
      }),
    ).toBe(8_475_667_200);
  });

  it('keeps all supported canonical positions inside the JavaScript safe-integer range', () => {
    expect(MAX_SAFE_TICKS).toBe(Number.MAX_SAFE_INTEGER);
    expect(Math.floor(MAX_SAFE_TICKS / TICKS_PER_SECOND)).toBeGreaterThanOrEqual(35_000);
  });

  it('clamps conversion results to the exact JavaScript integer range', () => {
    expect(secondsToTicks({ seconds: Number.MAX_VALUE })).toBe(MAX_SAFE_TICKS);
    expect(secondsToTicks({ seconds: -Number.MAX_VALUE })).toBe(-MAX_SAFE_TICKS);
  });
});

describe('frame-rate normalization', () => {
  it('maps legacy NTSC decimals to the exact standard rational rate', () => {
    expect(sanitizeFrameRate(29.97)).toEqual({ num: 30_000, den: 1_001 });
    expect(sanitizeFrameRate({ fps: 23.976 })).toEqual({ num: 24_000, den: 1_001 });
  });

  it('uses exact NTSC frame boundaries after normalizing a legacy decimal', () => {
    const frameRate = sanitizeFrameRate(29.97);
    const frameTicks = ticksPerFrame({ ticksPerSecond: TICKS_PER_SECOND, frameRate });
    expect(framesToTicks({ frames: 10_000, frameRate })).toBe(frameTicks * 10_000);
  });

  it('preserves a valid non-standard legacy rate as a reduced rational', () => {
    expect(sanitizeFrameRate(27.5)).toEqual({ num: 55, den: 2 });
  });
});

describe('timecode conversion', () => {
  it('formats and parses supported timecode shapes', () => {
    expect(formatTicksAsTimecode({ ticks: TICKS_PER_SECOND, fps: 30 })).toBe('00:00:01:00');
    expect(parseTimecodeToTicks({ timecode: '01:02:03:04', fps: 30 })).toBe(
      framesToTicks({ frames: 111_694, frameRate: { num: 30, den: 1 } }),
    );
    expect(parseTimecodeToTicks({ timecode: '03:04', fps: 30 })).toBe(
      framesToTicks({ frames: 94, frameRate: { num: 30, den: 1 } }),
    );
  });

  it('rejects malformed timecode', () => {
    expect(parseTimecodeToTicks({ timecode: '1.5', fps: 30 })).toBeNull();
    expect(parseTimecodeToTicks({ timecode: '00:00', fps: 0 })).toBeNull();
  });
});
