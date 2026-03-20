import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWheelSupport, getStepPrecision } from '~/composables/useWheelSupport';
import { ref } from 'vue';

describe('getStepPrecision', () => {
  it('returns 0 for integers', () => {
    expect(getStepPrecision(1)).toBe(0);
    expect(getStepPrecision(100)).toBe(0);
  });

  it('returns decimal places count for floats', () => {
    expect(getStepPrecision(0.1)).toBe(1);
    expect(getStepPrecision(0.01)).toBe(2);
    expect(getStepPrecision(1.234)).toBe(3);
  });
});

// Since we cannot easily test Vue lifecycle hooks in pure unit tests without mount,
// we will just ensure the file is parseable and getStepPrecision works.
