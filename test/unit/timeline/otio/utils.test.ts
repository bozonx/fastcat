/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  toRationalTime,
  fromRationalTimeTicks,
  toTimeRange,
  fromTimeRange,
  trackKindToOtioKind,
  normalizeTrackKind,
  trackKindFromOtioKind,
  assertTimelineTimebase,
  coerceId,
  coerceName,
  coerceBlendMode,
  clampNumber,
  hashString,
  buildFallbackItemId,
  resolveStableItemId,
  safeFastCatMetadata,
  isOtioPath,
  hexToRgbNormalized,
  rgbNormalizedToHex,
  toOtioColor,
  fromOtioColor,
  OtioValidationReport,
} from '~/timeline/otio/utils';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('toRationalTime', () => {
  it('converts ticks to rational time with a video frame rate', () => {
    const rt = toRationalTime(TICKS_PER_SECOND, 30);
    expect(rt.value).toBe(30);
    expect(rt.rate).toBe(30);
  });

  it('converts ticks to rational time without fps', () => {
    const rt = toRationalTime(TICKS_PER_SECOND / 2);
    expect(rt.value).toBe(TICKS_PER_SECOND / 2);
    expect(rt.rate).toBe(TICKS_PER_SECOND);
  });

  it('converts tick-aligned audio to an integer sample count', () => {
    const rt = toRationalTime(TICKS_PER_SECOND / 48_000, 48_000);
    expect(rt).toMatchObject({ value: 1, rate: 48_000 });
  });
});

describe('fromRationalTimeTicks', () => {
  it('converts rational time back to ticks', () => {
    expect(fromRationalTimeTicks({ value: 30, rate: 30 })).toBe(TICKS_PER_SECOND);
  });

  it('returns 0 for invalid input', () => {
    expect(fromRationalTimeTicks(null)).toBe(0);
    expect(fromRationalTimeTicks({ value: 10, rate: 0 })).toBe(0);
  });
});

describe('toTimeRange', () => {
  it('converts timeline range to otio time range', () => {
    const tr = toTimeRange({ startTicks: 0, durationTicks: TICKS_PER_SECOND }, 30);
    expect(tr.start_time.value).toBe(0);
    expect(tr.duration.value).toBe(30);
  });
});

describe('fromTimeRange', () => {
  it('converts otio time range back to timeline range', () => {
    expect(
      fromTimeRange({ start_time: { value: 0, rate: 30 }, duration: { value: 30, rate: 30 } }),
    ).toEqual({ startTicks: 0, durationTicks: TICKS_PER_SECOND });
  });

  it('returns zero range for invalid input', () => {
    expect(fromTimeRange(null)).toEqual({ startTicks: 0, durationTicks: 0 });
  });
});

describe('trackKindToOtioKind', () => {
  it('maps audio to Audio', () => {
    expect(trackKindToOtioKind('audio')).toBe('Audio');
  });

  it('maps video to Video', () => {
    expect(trackKindToOtioKind('video')).toBe('Video');
  });
});

describe('normalizeTrackKind', () => {
  it('returns valid kinds', () => {
    expect(normalizeTrackKind('audio')).toBe('audio');
    expect(normalizeTrackKind('video')).toBe('video');
  });

  it('handles string normalization', () => {
    expect(normalizeTrackKind('  Audio  ')).toBe('audio');
  });

  it('returns null for invalid kinds', () => {
    expect(normalizeTrackKind('invalid')).toBeNull();
    expect(normalizeTrackKind(123)).toBeNull();
  });
});

describe('trackKindFromOtioKind', () => {
  it('returns video for invalid kinds', () => {
    expect(trackKindFromOtioKind('unknown')).toBe('video');
  });
});

describe('assertTimelineTimebase', () => {
  it('returns fps from valid object', () => {
    expect(assertTimelineTimebase({ fps: 30 })).toEqual({ num: 30, den: 1 });
  });

  it('returns fallback for invalid input', () => {
    expect(assertTimelineTimebase(null)).toEqual({ num: 25, den: 1 });
    expect(assertTimelineTimebase({ fps: -5 })).toEqual({ num: 25, den: 1 });
  });
});

describe('coerceId', () => {
  it('returns trimmed string if valid', () => {
    expect(coerceId('  id-1  ', 'fallback')).toBe('id-1');
  });

  it('returns fallback for empty string', () => {
    expect(coerceId('', 'fallback')).toBe('fallback');
  });
});

describe('coerceName', () => {
  it('returns trimmed name if valid', () => {
    expect(coerceName('  Test  ', 'Fallback')).toBe('Test');
  });

  it('returns fallback for empty string', () => {
    expect(coerceName('', 'Fallback')).toBe('Fallback');
  });
});

describe('coerceBlendMode', () => {
  it('returns valid blend modes', () => {
    expect(coerceBlendMode('multiply')).toBe('multiply');
  });

  it('returns undefined for invalid modes', () => {
    expect(coerceBlendMode('invalid')).toBeUndefined();
  });
});

describe('clampNumber', () => {
  it('clamps numbers within range', () => {
    expect(clampNumber(50, 0, 100)).toBe(50);
    expect(clampNumber(-10, 0, 100)).toBe(0);
    expect(clampNumber(200, 0, 100)).toBe(100);
  });

  it('returns 0 for non-number input', () => {
    expect(clampNumber('text', 0, 100)).toBe(0);
  });
});

describe('hashString', () => {
  it('returns consistent hash for same input', () => {
    expect(hashString('test')).toBe(hashString('test'));
    expect(hashString('test')).not.toBe(hashString('other'));
  });
});

describe('buildFallbackItemId', () => {
  it('generates unique ids', () => {
    const occupied = new Set<string>();
    const id1 = buildFallbackItemId({
      prefix: 'clip',
      trackId: 'v1',
      fingerprint: 'abc',
      occupiedIds: occupied,
    });
    const id2 = buildFallbackItemId({
      prefix: 'clip',
      trackId: 'v1',
      fingerprint: 'abc',
      occupiedIds: occupied,
    });
    expect(id1).not.toBe(id2);
    expect(occupied.has(id1)).toBe(true);
    expect(occupied.has(id2)).toBe(true);
  });
});

describe('resolveStableItemId', () => {
  it('uses metadata id when available and not occupied', () => {
    const occupied = new Set<string>();
    const id = resolveStableItemId({
      prefix: 'clip',
      trackId: 'v1',
      fallbackFingerprint: 'abc',
      metadata: { id: 'meta-1' },
      occupiedIds: occupied,
    });
    expect(id).toBe('meta-1');
  });

  it('falls back to buildFallbackItemId when metadata id is occupied', () => {
    const occupied = new Set<string>(['meta-1']);
    const id = resolveStableItemId({
      prefix: 'clip',
      trackId: 'v1',
      fallbackFingerprint: 'abc',
      metadata: { fastcat: { id: 'meta-1' } },
      occupiedIds: occupied,
    });
    expect(id).not.toBe('meta-1');
  });
});

describe('safeFastCatMetadata', () => {
  it('extracts fastcat metadata', () => {
    expect(safeFastCatMetadata({ fastcat: { version: 1 } })).toEqual({ version: 1 });
  });

  it('returns empty object for invalid input', () => {
    expect(safeFastCatMetadata(null)).toEqual({});
    expect(safeFastCatMetadata({})).toEqual({});
  });
});

describe('isOtioPath', () => {
  it('returns true for .otio paths', () => {
    expect(isOtioPath('timeline.otio')).toBe(true);
    expect(isOtioPath('timeline.OTIO')).toBe(true);
  });

  it('returns false for non-otio paths', () => {
    expect(isOtioPath('video.mp4')).toBe(false);
  });
});

describe('hexToRgbNormalized', () => {
  it('converts hex to normalized rgb', () => {
    expect(hexToRgbNormalized('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgbNormalized('#00ff00')).toEqual([0, 1, 0]);
    expect(hexToRgbNormalized('#0000ff')).toEqual([0, 0, 1]);
  });

  it('handles short hex', () => {
    expect(hexToRgbNormalized('#f00')).toEqual([1, 0, 0]);
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgbNormalized('invalid')).toBeNull();
  });
});

describe('rgbNormalizedToHex', () => {
  it('converts normalized rgb to hex', () => {
    expect(rgbNormalizedToHex([1, 0, 0])).toBe('#ff0000');
    expect(rgbNormalizedToHex([0, 1, 0])).toBe('#00ff00');
  });

  it('returns null for invalid input', () => {
    expect(rgbNormalizedToHex(null as any)).toBeNull();
    expect(rgbNormalizedToHex([1, 0])).toBeNull();
  });
});

describe('toOtioColor', () => {
  it('converts hex to otio color', () => {
    const color = toOtioColor('#ff0000');
    expect(color?.OTIO_SCHEMA).toBe('Color.1');
    expect(color?.rgb).toEqual([1, 0, 0]);
  });

  it('returns undefined for invalid hex', () => {
    expect(toOtioColor('invalid')).toBeUndefined();
  });
});

describe('fromOtioColor', () => {
  it('converts otio color to hex', () => {
    expect(fromOtioColor({ OTIO_SCHEMA: 'Color.1', rgb: [1, 0, 0] })).toBe('#ff0000');
  });

  it('returns undefined for invalid color', () => {
    expect(fromOtioColor(null)).toBeUndefined();
    expect(fromOtioColor({ OTIO_SCHEMA: 'Other.1', rgb: [1, 0, 0] })).toBeUndefined();
  });
});

describe('OtioValidationReport', () => {
  it('tracks warnings', () => {
    const report = new OtioValidationReport();
    expect(report.hasWarnings()).toBe(false);
    report.warn('test', 'Test warning');
    expect(report.hasWarnings()).toBe(true);
    expect(report.warnings).toHaveLength(1);
  });
});
