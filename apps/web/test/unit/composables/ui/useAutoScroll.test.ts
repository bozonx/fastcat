/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useAutoScroll } from '~/composables/ui/useAutoScroll';

describe('useAutoScroll', () => {
  let originalAddEventListener: typeof window.addEventListener;
  let originalRemoveEventListener: typeof window.removeEventListener;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.addEventListener = vi.fn();
    window.removeEventListener = vi.fn();
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('returns drag event handlers', () => {
    const el = ref<HTMLElement | null>(null);
    const { onDragOver, onDragLeave, onDrop, stopAutoScroll } = useAutoScroll(el);
    expect(typeof onDragOver).toBe('function');
    expect(typeof onDragLeave).toBe('function');
    expect(typeof onDrop).toBe('function');
    expect(typeof stopAutoScroll).toBe('function');
  });

  it('stopAutoScroll does not throw when nothing is active', () => {
    const el = ref<HTMLElement | null>(null);
    const { stopAutoScroll } = useAutoScroll(el);
    expect(() => stopAutoScroll()).not.toThrow();
  });

  it('onDragOver stores last drag event', () => {
    const el = ref<HTMLElement | null>(null);
    const { onDragOver } = useAutoScroll(el);
    const fakeEvent = { clientY: 100 } as DragEvent;
    expect(() => onDragOver(fakeEvent)).not.toThrow();
  });

  it('onDragLeave with null relatedTarget stops auto scroll', () => {
    const el = ref<HTMLElement | null>(null);
    const { onDragLeave } = useAutoScroll(el);
    const fakeEvent = {
      relatedTarget: null,
      currentTarget: null,
    } as unknown as DragEvent;
    expect(() => onDragLeave(fakeEvent)).not.toThrow();
  });

  it('onDrop is stopAutoScroll', () => {
    const el = ref<HTMLElement | null>(null);
    const { onDrop, stopAutoScroll } = useAutoScroll(el);
    expect(onDrop).toBe(stopAutoScroll);
  });

  it('onDragOver with element schedules auto scroll', () => {
    const mockEl = {
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 200,
        left: 0,
        right: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      scrollTop: 0,
    } as unknown as HTMLElement;
    const el = ref<HTMLElement | null>(mockEl);
    const { onDragOver } = useAutoScroll(el);
    // clientY near top edge (within default zone of 48px)
    const fakeEvent = { clientY: 10 } as DragEvent;
    onDragOver(fakeEvent);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('onDragOver attaches wheel and dragend listeners', () => {
    const mockEl = {
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 200,
        left: 0,
        right: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      scrollTop: 0,
    } as unknown as HTMLElement;
    const el = ref<HTMLElement | null>(mockEl);
    const { onDragOver } = useAutoScroll(el);
    onDragOver({ clientY: 100 } as DragEvent);
    expect(window.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), {
      passive: false,
    });
    expect(window.addEventListener).toHaveBeenCalledWith('dragend', expect.any(Function), {
      capture: true,
    });
    expect(window.addEventListener).toHaveBeenCalledWith('drop', expect.any(Function), {
      capture: true,
    });
  });

  it('stopAutoScroll removes listeners after onDragOver', () => {
    const mockEl = {
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 200,
        left: 0,
        right: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      scrollTop: 0,
    } as unknown as HTMLElement;
    const el = ref<HTMLElement | null>(mockEl);
    const { onDragOver, stopAutoScroll } = useAutoScroll(el);
    onDragOver({ clientY: 100 } as DragEvent);
    stopAutoScroll();
    expect(window.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
  });
});
