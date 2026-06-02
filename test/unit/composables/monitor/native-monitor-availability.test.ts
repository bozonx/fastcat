import { beforeEach, describe, expect, it } from 'vitest';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
  resetNativeMonitorAvailability,
} from '~/composables/monitor/native-monitor-availability';

describe('native monitor availability', () => {
  beforeEach(() => {
    resetNativeMonitorAvailability();
  });

  it('disables native monitor after init failure', () => {
    const disabledNow = markNativeMonitorInitFailure(
      'monitor init failed: winit EventLoop::build failed',
    );

    expect(disabledNow).toBe(true);
    expect(isNativeMonitorDisabled()).toBe(true);
  });

  it('keeps native monitor enabled for unrelated failures', () => {
    const disabledNow = markNativeMonitorInitFailure('monitor_seek failed');

    expect(disabledNow).toBe(false);
    expect(isNativeMonitorDisabled()).toBe(false);
  });
});
