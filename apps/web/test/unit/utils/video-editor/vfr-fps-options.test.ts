/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildVfrFrameRateOptions,
  formatFrameRateLabel,
} from '~/utils/video-editor/vfr-fps-options';

describe('buildVfrFrameRateOptions', () => {
  it('includes the detected rate (snapped) plus common rates, sorted ascending', () => {
    const opts = buildVfrFrameRateOptions(29.97);
    const values = opts.map((o) => o.value);
    // Ascending.
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    // Detected 29.97 is present and flagged.
    const detected = opts.find((o) => o.isDetected);
    expect(detected).toBeDefined();
    expect(detected!.label).toBe('29.97');
    // Common rates are offered.
    expect(opts.some((o) => o.label === '24')).toBe(true);
    expect(opts.some((o) => o.label === '60')).toBe(true);
  });

  it('collapses the detected average into a common rate it snaps to (no duplicate)', () => {
    // 30.0004 is within the 0.001 snap tolerance of 30 → a single "30" option,
    // flagged detected, instead of a near-duplicate next to the common 30.
    const opts = buildVfrFrameRateOptions(30.0004);
    const thirties = opts.filter((o) => Math.round(o.value) === 30);
    expect(thirties).toHaveLength(1);
    expect(thirties[0]!.isDetected).toBe(true);
    expect(thirties[0]!.label).toBe('30');
  });

  it('exactly one option is flagged detected', () => {
    const opts = buildVfrFrameRateOptions(47.9);
    expect(opts.filter((o) => o.isDetected)).toHaveLength(1);
  });

  it('falls back to a valid detected option for a bogus rate', () => {
    const opts = buildVfrFrameRateOptions(0);
    // A non-positive detected fps sanitizes to the default (30) which is a common rate.
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.filter((o) => o.isDetected).length).toBeLessThanOrEqual(1);
  });
});

describe('formatFrameRateLabel', () => {
  it('shows integers without decimals', () => {
    expect(formatFrameRateLabel(30)).toBe('30');
    expect(formatFrameRateLabel(60)).toBe('60');
  });

  it('shows broadcast fractional rates with trimmed decimals', () => {
    expect(formatFrameRateLabel(30000 / 1001)).toBe('29.97');
    expect(formatFrameRateLabel(24000 / 1001)).toBe('23.976');
  });

  it('returns empty for a bogus value', () => {
    expect(formatFrameRateLabel(0)).toBe('');
    expect(formatFrameRateLabel(NaN)).toBe('');
  });
});
