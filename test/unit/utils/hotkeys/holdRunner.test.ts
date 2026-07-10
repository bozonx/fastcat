/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

describe('createHotkeyHoldRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not restart the hold timer for repeated keydown of the same key', () => {
    vi.useFakeTimers();
    const runner = createHotkeyHoldRunner();
    const action = vi.fn();

    runner.startHold({
      keyCode: 'KeyL',
      delayMs: 350,
      intervalMs: 100,
      action,
    });
    runner.startHold({
      keyCode: 'KeyL',
      delayMs: 350,
      intervalMs: 100,
      action,
    });

    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(449);
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(2);

    runner.clearTimers();
  });

  it('starts a new hold when the key changes', () => {
    vi.useFakeTimers();
    const runner = createHotkeyHoldRunner();
    const firstAction = vi.fn();
    const secondAction = vi.fn();

    runner.startHold({
      keyCode: 'KeyL',
      delayMs: 350,
      intervalMs: 100,
      action: firstAction,
    });
    runner.startHold({
      keyCode: 'KeyJ',
      delayMs: 350,
      intervalMs: 100,
      action: secondAction,
    });

    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(450);
    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).toHaveBeenCalledTimes(2);

    runner.clearTimers();
  });
});
