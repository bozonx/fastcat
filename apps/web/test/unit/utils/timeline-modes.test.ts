/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';

describe('DEFAULT_SNAP_SETTINGS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_SNAP_SETTINGS.frameSnapMode).toBe('frames');
    expect(DEFAULT_SNAP_SETTINGS.snapThresholdPx).toBe(8);
  });
});
