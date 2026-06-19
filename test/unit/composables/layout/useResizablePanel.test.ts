/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { useResizablePanel } from '~/composables/layout/useResizablePanel';

interface MockHandle {
  setPointerCapture: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function createMockHandle(): MockHandle {
  return {
    setPointerCapture: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createMockContainer(rect: Partial<DOMRect> = {}) {
  return {
    getBoundingClientRect: () =>
      ({
        top: 0,
        left: 0,
        width: 1000,
        height: 800,
        bottom: 800,
        right: 1000,
        ...rect,
      }) as DOMRect,
  } as HTMLElement;
}

describe('useResizablePanel', () => {
  const containerRef = ref<HTMLElement | null>(null);
  const value = ref(40);
  const handle = createMockHandle();

  beforeEach(() => {
    containerRef.value = createMockContainer();
    value.value = 40;
    vi.clearAllMocks();
  });

  function triggerListener(
    name: 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
    event: PointerEvent,
  ) {
    const calls = handle.addEventListener.mock.calls as Array<[string, (e: PointerEvent) => void]>;
    const call = calls.find(([n]) => n === name);
    if (call) call[1](event);
  }

  it('updates horizontal size on pointer move', () => {
    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation: ref('horizontal'),
      minPercent: 20,
      maxPercent: 70,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 1 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });

    onDividerPointerDown(downEvent);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);

    triggerListener('pointermove', new PointerEvent('pointermove', { clientX: 500, clientY: 100 }));
    expect(value.value).toBe(50);
  });

  it('clamps horizontal size to min/max', () => {
    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation: ref('horizontal'),
      minPercent: 20,
      maxPercent: 70,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 2 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });
    onDividerPointerDown(downEvent);

    triggerListener('pointermove', new PointerEvent('pointermove', { clientX: 0 }));
    expect(value.value).toBe(20);

    triggerListener('pointermove', new PointerEvent('pointermove', { clientX: 1200 }));
    expect(value.value).toBe(70);
  });

  it('updates vertical size on pointer move', () => {
    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation: ref('vertical'),
      minPercent: 20,
      maxPercent: 65,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 3 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });
    onDividerPointerDown(downEvent);

    triggerListener('pointermove', new PointerEvent('pointermove', { clientY: 400 }));
    expect(value.value).toBe(50);
  });

  it('supports reactive orientation and maxPercent', () => {
    const orientation = ref<'horizontal' | 'vertical'>('horizontal');
    const maxPercent = computed(() => (orientation.value === 'horizontal' ? 70 : 65));

    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation,
      minPercent: 20,
      maxPercent,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 4 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });
    onDividerPointerDown(downEvent);

    triggerListener('pointermove', new PointerEvent('pointermove', { clientX: 900, clientY: 750 }));
    expect(value.value).toBe(70);

    orientation.value = 'vertical';
    triggerListener('pointermove', new PointerEvent('pointermove', { clientX: 900, clientY: 750 }));
    expect(value.value).toBe(65);
  });

  it('removes event listeners on pointerup', () => {
    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation: ref('horizontal'),
      minPercent: 20,
      maxPercent: 70,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 5 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });
    onDividerPointerDown(downEvent);

    triggerListener('pointerup', new PointerEvent('pointerup'));
    expect(handle.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(handle.removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(handle.removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function));
    expect(handle.removeEventListener).toHaveBeenCalledWith(
      'lostpointercapture',
      expect.any(Function),
    );
  });

  it('does nothing when container is missing', () => {
    containerRef.value = null;
    const { onDividerPointerDown } = useResizablePanel({
      containerRef,
      orientation: ref('horizontal'),
      minPercent: 20,
      maxPercent: 70,
      getValue: () => value.value,
      setValue: (v: number) => {
        value.value = v;
      },
    });

    const downEvent = new PointerEvent('pointerdown', { button: 0, pointerId: 6 });
    Object.defineProperty(downEvent, 'currentTarget', { value: handle });

    expect(() => onDividerPointerDown(downEvent)).not.toThrow();
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
  });
});
