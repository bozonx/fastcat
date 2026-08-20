/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  clampNumber,
  sanitizeBlendMode,
  sanitizeSourceOrientation,
  sanitizeAnimations,
  clampAudioFadeTicks,
  sanitizeTransform,
  sanitizeTextStyle,
} from '~/timeline/commands/item/clip-property-sanitizers';

describe('clampNumber', () => {
  it('clamps within range and coerces non-numbers to 0', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber(50, 0, 10)).toBe(10);
    expect(clampNumber('nope', -1, 1)).toBe(0);
    expect(clampNumber(Number.NaN, -1, 1)).toBe(0);
    expect(clampNumber(Number.POSITIVE_INFINITY, -1, 1)).toBe(0);
  });
});

describe('sanitizeBlendMode', () => {
  it('accepts known modes and rejects everything else', () => {
    for (const mode of ['add', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'normal']) {
      expect(sanitizeBlendMode(mode)).toBe(mode);
    }
    expect(sanitizeBlendMode('invalid-mode')).toBeUndefined();
    expect(sanitizeBlendMode(42)).toBeUndefined();
    expect(sanitizeBlendMode(undefined)).toBeUndefined();
  });
});

describe('sanitizeSourceOrientation', () => {
  it('accepts the allowed orientations only', () => {
    for (const o of ['auto', '0', '90', '180', '270']) {
      expect(sanitizeSourceOrientation(o)).toBe(o);
    }
    expect(sanitizeSourceOrientation('45')).toBeUndefined();
    expect(sanitizeSourceOrientation(90)).toBeUndefined();
  });
});

describe('sanitizeAnimations', () => {
  it('normalizes invalid easing to linear before crossing renderer boundaries', () => {
    const result = sanitizeAnimations({
      opacity: {
        keyframes: [{ tTicks: 10, value: 0.5, easing: 'snappy' }],
      },
    });
    expect(result?.opacity?.keyframes).toEqual([{ tTicks: 10, value: 0.5, easing: 'linear' }]);
  });

  it('keeps well-formed effect-param paths', () => {
    const result = sanitizeAnimations({
      'effect.blur.radius': {
        keyframes: [{ tTicks: 10, value: 0.5, easing: 'linear' }],
      },
    });
    expect(result?.['effect.blur.radius']?.keyframes).toEqual([
      { tTicks: 10, value: 0.5, easing: 'linear' },
    ]);
  });

  it('drops unknown / malformed animation paths', () => {
    const result = sanitizeAnimations({
      'not.a.real.path': { keyframes: [{ tTicks: 10, value: 0.5, easing: 'linear' }] },
      'effect.': { keyframes: [{ tTicks: 0, value: 1, easing: 'linear' }] },
    });
    expect(result).toBeUndefined();
  });
});

describe('clampAudioFadeTicks', () => {
  it('returns undefined for undefined input', () => {
    expect(clampAudioFadeTicks(undefined, 1000)).toBeUndefined();
  });

  it('rounds and clamps to [0, maxTicks]', () => {
    expect(clampAudioFadeTicks(500.4, 1000)).toBe(500);
    expect(clampAudioFadeTicks(-10, 1000)).toBe(0);
    expect(clampAudioFadeTicks(5000, 1000)).toBe(1000);
    expect(clampAudioFadeTicks('bad', 1000)).toBe(0);
  });
});

describe('sanitizeTransform', () => {
  it('returns undefined when no recognizable field is present', () => {
    expect(sanitizeTransform(undefined)).toBeUndefined();
    expect(sanitizeTransform('x')).toBeUndefined();
    expect(sanitizeTransform({ unknown: 1 })).toBeUndefined();
  });

  it('normalizes and clamps nested fields', () => {
    const result = sanitizeTransform({
      scale: { x: 5000, y: -5000, linked: 1 },
      rotationDeg: 99999,
      position: { x: 2_000_000, y: -2_000_000 },
      anchor: { preset: 'custom', x: 99, y: -99 },
      crop: { top: 200, bottom: -5, left: 50, right: 'oops' },
    });
    expect(result).toEqual({
      scale: { x: 1000, y: -1000, linked: true },
      rotationDeg: 36000,
      position: { x: 1_000_000, y: -1_000_000 },
      anchor: { preset: 'custom', x: 10, y: -10 },
      crop: { top: 100, bottom: 0, left: 50, right: 0 },
    });
  });

  it('drops anchor offsets for non-custom presets', () => {
    const result = sanitizeTransform({ anchor: { preset: 'center', x: 5, y: 5 } });
    expect(result?.anchor).toEqual({ preset: 'center', x: undefined, y: undefined });
  });

  it('rejects unknown anchor presets', () => {
    expect(sanitizeTransform({ anchor: { preset: 'weird' } })).toBeUndefined();
  });
});

describe('sanitizeTextStyle', () => {
  it('returns undefined for non-objects', () => {
    expect(sanitizeTextStyle(undefined)).toBeUndefined();
    expect(sanitizeTextStyle('text')).toBeUndefined();
  });

  it('returns undefined when no valid field survives', () => {
    expect(sanitizeTextStyle({ fontSize: 'big', color: 42 })).toBeUndefined();
  });

  it('keeps valid fields and drops invalid ones', () => {
    const result = sanitizeTextStyle({
      fontFamily: 'Inter',
      fontSize: 48.6,
      color: '#fff',
      colorAlpha: 5,
      align: 'centre',
      lineHeight: 50,
    });
    expect(result).toMatchObject({
      fontFamily: 'Inter',
      fontSize: 49,
      color: '#fff',
      colorAlpha: 1,
      lineHeight: 10,
    });
    // invalid align value is dropped entirely
    expect(result && 'align' in result).toBe(false);
  });

  it('preserves explicit width/height keys even when invalid (set to undefined)', () => {
    const result = sanitizeTextStyle({ width: -10, height: 0 });
    expect(result).toEqual({ width: undefined, height: undefined });
  });

  it('expands a numeric padding into all four edges', () => {
    expect(sanitizeTextStyle({ padding: 12 })).toEqual({
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
    });
    // numeric padding is not subject to the all-zero collapse (object form is)
    expect(sanitizeTextStyle({ padding: 0 })).toEqual({
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  });

  it('drops an all-zero object padding', () => {
    expect(
      sanitizeTextStyle({ padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
    ).toBeUndefined();
  });

  it('resolves padding edges over x/y shorthand', () => {
    const result = sanitizeTextStyle({ padding: { x: 4, y: 8, top: 1 } });
    expect(result).toEqual({ padding: { top: 1, right: 0, bottom: 0, left: 0 } });
  });

  it('trims string fields and drops empty results', () => {
    const result = sanitizeTextStyle({ textShadowColor: '   ', borderColor: ' #abc ' });
    expect(result).toEqual({ borderColor: '#abc' });
  });
});
