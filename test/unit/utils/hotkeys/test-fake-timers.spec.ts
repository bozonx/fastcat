import { vi, test, expect } from 'vitest';

test('fake timers with window.setTimeout in happy-dom', () => {
  vi.useFakeTimers();
  const action = vi.fn();
  window.setTimeout(action, 300);
  vi.advanceTimersByTime(300);
  expect(action).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
