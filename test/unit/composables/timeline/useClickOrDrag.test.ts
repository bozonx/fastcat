/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useClickOrDrag } from '~/composables/timeline/useClickOrDrag';

describe('useClickOrDrag', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps long press active when drag start is rejected', () => {
    vi.useFakeTimers();

    const onLongPress = vi.fn();
    const onDragStart = vi.fn(() => false);
    const scope = effectScope();
    const api = scope.run(() => useClickOrDrag({ onDragStart, onLongPress }));

    if (!api) {
      throw new Error('Failed to initialize useClickOrDrag');
    }

    api.onPointerDown(
      new PointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        pointerType: 'touch',
      }),
    );

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 10,
        pointerType: 'touch',
      }),
    );

    expect(onDragStart).not.toHaveBeenCalled();
    expect(api.didStartDrag.value).toBe(false);

    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(api.longPressTriggered.value).toBe(true);

    scope.stop();
  });

  it('prefers long press over drag on touch jitter when drag start is allowed', () => {
    vi.useFakeTimers();

    const onLongPress = vi.fn();
    const onDragStart = vi.fn(() => true);
    const scope = effectScope();
    const api = scope.run(() => useClickOrDrag({ onDragStart, onLongPress }));

    if (!api) {
      throw new Error('Failed to initialize useClickOrDrag');
    }

    api.onPointerDown(
      new PointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        pointerType: 'touch',
      }),
    );

    window.dispatchEvent(
      new PointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: 18,
        clientY: 10,
        pointerType: 'touch',
      }),
    );

    expect(onDragStart).not.toHaveBeenCalled();
    expect(api.didStartDrag.value).toBe(false);

    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(api.longPressTriggered.value).toBe(true);
    expect(api.didStartDrag.value).toBe(false);

    scope.stop();
  });

  it('fires long press even after pointercancel on touch', () => {
    vi.useFakeTimers();

    const onLongPress = vi.fn();
    const onDragStart = vi.fn(() => true);
    const scope = effectScope();
    const api = scope.run(() => useClickOrDrag({ onDragStart, onLongPress }));

    if (!api) {
      throw new Error('Failed to initialize useClickOrDrag');
    }

    api.onPointerDown(
      new PointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 10,
        clientY: 10,
        pointerType: 'touch',
      }),
    );

    // Browser fires pointercancel before long press timer (e.g. native context menu)
    vi.advanceTimersByTime(300);
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }));

    expect(onLongPress).not.toHaveBeenCalled();

    // Timer should still fire after the remaining 200ms
    vi.advanceTimersByTime(200);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(api.longPressTriggered.value).toBe(true);

    scope.stop();
  });
});
