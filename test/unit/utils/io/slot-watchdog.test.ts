// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { watchHeldSlot } from '~/utils/io/slot-watchdog';

describe('watchHeldSlot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards release exactly once and clears the timer (no warning)', () => {
    vi.useFakeTimers();
    const inner = vi.fn();
    const warn = vi.fn();
    const release = watchHeldSlot(inner, { label: 'x', warnMs: 1000, warn });

    release();
    release();

    expect(inner).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the slot is held past the threshold', () => {
    vi.useFakeTimers();
    const inner = vi.fn();
    const warn = vi.fn();
    const release = watchHeldSlot(inner, { label: 'streaming', warnMs: 1000, warn });

    vi.advanceTimersByTime(1500);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('streaming');

    release();
    // A second message confirms the slot was eventually released.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('disables the watchdog when warnMs <= 0 but still forwards release once', () => {
    const inner = vi.fn();
    const warn = vi.fn();
    const release = watchHeldSlot(inner, { label: 'x', warnMs: 0, warn });

    release();
    release();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
