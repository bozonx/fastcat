import { vi, test, expect } from 'vitest';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

test('holdRunner with fake timers', () => {
  const runner = createHotkeyHoldRunner();
  vi.useFakeTimers();
  const action = vi.fn();
  runner.startHold({ keyCode: 'ArrowRight', delayMs: 300, intervalMs: 50, action });
  expect(action).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300);
  expect(action).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
