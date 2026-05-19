import { vi, test, expect } from 'vitest';

function createRunner() {
  return {
    start(delayMs: number, action: () => void) {
      window.setTimeout(action, delayMs);
    }
  };
}

test('fake timers with captured window.setTimeout', () => {
  const runner = createRunner();
  vi.useFakeTimers();
  const action = vi.fn();
  runner.start(300, action);
  vi.advanceTimersByTime(300);
  expect(action).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
