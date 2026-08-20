import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  scheduleWaveformRedraw,
  cancelWaveformRedraw,
  __resetWaveformSchedulerForTests,
} from '~/utils/audio/waveform-render-scheduler';

describe('waveform render scheduler', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    __resetWaveformSchedulerForTests();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    __resetWaveformSchedulerForTests();
    vi.unstubAllGlobals();
  });

  function runFrame() {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(performance.now());
  }

  it('coalesces multiple schedules for the same key into one run', () => {
    const job = vi.fn();
    scheduleWaveformRedraw('a', job);
    scheduleWaveformRedraw('a', job);
    scheduleWaveformRedraw('a', job);

    // Only one frame should have been requested.
    expect(rafCallbacks.length).toBe(1);
    runFrame();
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('runs the latest job registered for a key', () => {
    const first = vi.fn();
    const second = vi.fn();
    scheduleWaveformRedraw('a', first);
    scheduleWaveformRedraw('a', second);
    runFrame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs jobs for distinct keys in the same frame', () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleWaveformRedraw('a', a);
    scheduleWaveformRedraw('b', b);
    runFrame();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents a pending job from running', () => {
    const job = vi.fn();
    scheduleWaveformRedraw('a', job);
    cancelWaveformRedraw('a');
    runFrame();
    expect(job).not.toHaveBeenCalled();
  });

  it('isolates a throwing job from the rest of the frame', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    scheduleWaveformRedraw('a', bad);
    scheduleWaveformRedraw('b', good);
    expect(() => runFrame()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
