// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

describe('createHotkeyHoldRunner', () => {
  let runner: ReturnType<typeof createHotkeyHoldRunner>;

  beforeEach(() => {
    runner = createHotkeyHoldRunner();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes action immediately on startHold', () => {
    const action = vi.fn();
    runner.startHold({ keyCode: 'ArrowRight', action });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('repeats action after delay and interval', () => {
    const action = vi.fn();
    runner.startHold({ keyCode: 'ArrowRight', delayMs: 300, intervalMs: 50, action });
    expect(action).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    expect(action).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(100);
    expect(action).toHaveBeenCalledTimes(4);
  });

  it('stops on handleKeyup for matching key', () => {
    const action = vi.fn();
    runner.startHold({ keyCode: 'ArrowRight', delayMs: 300, intervalMs: 50, action });
    vi.advanceTimersByTime(300);
    expect(action).toHaveBeenCalledTimes(2);

    runner.handleKeyup('ArrowRight');
    vi.advanceTimersByTime(200);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not stop on handleKeyup for different key', () => {
    const action = vi.fn();
    runner.startHold({ keyCode: 'ArrowRight', delayMs: 300, intervalMs: 50, action });
    vi.advanceTimersByTime(300);
    expect(action).toHaveBeenCalledTimes(2);

    runner.handleKeyup('ArrowLeft');
    vi.advanceTimersByTime(100);
    expect(action).toHaveBeenCalledTimes(4);
  });

  it('clears timers on clearTimers', () => {
    const action = vi.fn();
    runner.startHold({ keyCode: 'ArrowRight', delayMs: 300, intervalMs: 50, action });
    runner.clearTimers();
    vi.advanceTimersByTime(500);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
