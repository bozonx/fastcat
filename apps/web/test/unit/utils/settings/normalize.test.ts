/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeUserSettings } from '~/utils/settings/normalize';

describe('normalizeUserSettings', () => {
  it('returns default settings for null input', () => {
    const result = normalizeUserSettings(null);
    expect(result.locale).toBeDefined();
    expect(result.projectDefaults).toBeDefined();
    expect(result.projectPresets).toBeDefined();
  });

  it('returns default settings for undefined input', () => {
    const result = normalizeUserSettings(undefined);
    expect(result.locale).toBeDefined();
    expect(result.projectDefaults).toBeDefined();
  });

  it('preserves valid settings from input', () => {
    const input = {
      locale: 'en-US',
      openLastProjectOnStart: true,
      deleteWithoutConfirmation: false,
    };
    const result = normalizeUserSettings(input);
    expect(result.locale).toBe('en-US');
    expect(result.openLastProjectOnStart).toBe(true);
    expect(result.deleteWithoutConfirmation).toBe(false);
  });

  it('caps snapThresholdPx at 50', () => {
    const input = {
      timeline: {
        snapThresholdPx: 100,
      },
    };
    const result = normalizeUserSettings(input);
    expect(result.timeline.snapThresholdPx).toBe(8);
  });

  it('keeps valid snapThresholdPx within [1, 50]', () => {
    const input = {
      timeline: {
        snapThresholdPx: 25,
      },
    };
    const result = normalizeUserSettings(input);
    expect(result.timeline.snapThresholdPx).toBe(25);
  });
});
