/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_TICKS_PER_SECOND,
  STANDARD_AUDIO_SAMPLE_RATES,
  STANDARD_FRAME_RATES,
  TICKS_PER_SECOND,
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
  it('keeps the legacy microsecond rate until the document migration', () => {
    expect(TICKS_PER_SECOND).toBe(1_000_000);
    expect(ticksToSeconds(500_000)).toBe(0.5);
    expect(secondsToTicks({ seconds: 0.5 })).toBe(500_000);
    expect(secondsToTicks({ seconds: -0.000_000_5, mode: 'floor' })).toBe(-1);
  });

  it('quantizes frame conversions with the requested rounding mode', () => {
    const frameRate = { num: 30, den: 1 };

    expect(ticksToFrames({ ticks: 1_000_001, frameRate, mode: 'floor' })).toBe(30);
    expect(ticksToFrames({ ticks: 1_000_001, frameRate, mode: 'ceil' })).toBe(31);
    expect(framesToTicks({ frames: 30, frameRate })).toBe(1_000_000);
    expect(quantizeTicksToFrame({ ticks: 1_000_001, frameRate })).toBe(1_000_000);
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
});

describe('frame-rate normalization', () => {
  it('maps legacy NTSC decimals to the exact standard rational rate', () => {
    expect(sanitizeFrameRate(29.97)).toEqual({ num: 30_000, den: 1_001 });
    expect(sanitizeFrameRate({ fps: 23.976 })).toEqual({ num: 24_000, den: 1_001 });
  });

  it('preserves a valid non-standard legacy rate as a reduced rational', () => {
    expect(sanitizeFrameRate(27.5)).toEqual({ num: 55, den: 2 });
  });
});

describe('timecode conversion', () => {
  it('formats and parses supported timecode shapes', () => {
    expect(formatTicksAsTimecode({ ticks: 1_000_000, fps: 30 })).toBe('00:00:01:00');
    expect(parseTimecodeToTicks({ timecode: '01:02:03:04', fps: 30 })).toBe(3_723_133_333);
    expect(parseTimecodeToTicks({ timecode: '03:04', fps: 30 })).toBe(3_133_333);
  });

  it('rejects malformed timecode', () => {
    expect(parseTimecodeToTicks({ timecode: '1.5', fps: 30 })).toBeNull();
    expect(parseTimecodeToTicks({ timecode: '00:00', fps: 0 })).toBeNull();
  });
});
