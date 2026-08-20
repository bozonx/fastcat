/** @vitest-environment happy-dom */
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelinePointerSession } from '~/composables/timeline/useTimelinePointerSession';

let activeWrapper: VueWrapper | null = null;

function setup() {
  let api!: ReturnType<typeof useTimelinePointerSession>;
  const Comp = defineComponent({
    setup() {
      api = useTimelinePointerSession();
      return () => h('div');
    },
  });
  activeWrapper = mount(Comp);
  return api!;
}

describe('useTimelinePointerSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic rAF: capture the callback so the test controls when it runs.
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {};
    });
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  let rafCallbacks: FrameRequestCallback[] = [];
  function flushRaf() {
    const pending = rafCallbacks;
    rafCallbacks = [];
    pending.forEach((cb) => cb(0));
  }

  it('routes window pointer/key events to the bound handlers', () => {
    const api = setup();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();

    api.bindSession({ onPointerMove, onPointerUp, onKeyDown, onKeyUp });

    window.dispatchEvent(new MouseEvent('pointermove'));
    window.dispatchEvent(new MouseEvent('pointerup'));
    window.dispatchEvent(new KeyboardEvent('keydown'));
    window.dispatchEvent(new KeyboardEvent('keyup'));

    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyUp).toHaveBeenCalledTimes(1);
  });

  it('clearSession detaches all listeners', () => {
    const api = setup();
    const onPointerMove = vi.fn();
    api.bindSession({ onPointerMove });

    api.clearSession();
    window.dispatchEvent(new MouseEvent('pointermove'));

    expect(onPointerMove).not.toHaveBeenCalled();
  });

  it('rebinding replaces the previous handlers (no double-dispatch)', () => {
    const api = setup();
    const first = vi.fn();
    const second = vi.fn();

    api.bindSession({ onPointerMove: first });
    api.bindSession({ onPointerMove: second });

    window.dispatchEvent(new MouseEvent('pointermove'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple scheduleUpdate calls into a single rAF flush', () => {
    const api = setup();
    const update = vi.fn();

    api.scheduleUpdate(() => update('a'));
    api.scheduleUpdate(() => update('b'));
    expect(update).not.toHaveBeenCalled();

    flushRaf();

    // Only the latest scheduled update runs, exactly once.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('b');
  });

  it('cancels a pending scheduled update when the session is cleared', () => {
    const api = setup();
    const update = vi.fn();

    api.scheduleUpdate(update);
    api.clearSession();
    flushRaf();

    expect(update).not.toHaveBeenCalled();
  });

  it('detaches listeners on unmount', () => {
    const api = setup();
    const onPointerMove = vi.fn();
    api.bindSession({ onPointerMove });

    activeWrapper?.unmount();
    activeWrapper = null;

    window.dispatchEvent(new MouseEvent('pointermove'));
    expect(onPointerMove).not.toHaveBeenCalled();
  });
});
