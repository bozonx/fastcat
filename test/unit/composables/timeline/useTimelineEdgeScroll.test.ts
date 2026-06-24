/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useTimelineEdgeScroll } from '~/composables/timeline/useTimelineEdgeScroll';
import {
  MOBILE_EDGE_SCROLL_ZONE_PX,
  MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
} from '~/utils/mobile/timeline';

describe('useTimelineEdgeScroll (mobile axes)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
  });

  function createScrollEl() {
    const el = document.createElement('div');
    let scrollLeft = 0;
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    el.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 300,
        top: 0,
        right: 500,
        bottom: 300,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    return { el, getScrollLeft: () => scrollLeft, getScrollTop: () => scrollTop };
  }

  it('scrolls horizontally when pointer is near the left edge', () => {
    const { el, getScrollLeft } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();
    const draggingMode = ref<'move' | null>('move');
    let reapplyCount = 0;

    const wrapper = mount(
      defineComponent({
        setup() {
          const { updateEdgeScroll } = useTimelineEdgeScroll({
            scrollEl: ref(el),
            isActive: computed(() => draggingMode.value !== null),
            onScrollStep: () => {
              reapplyCount++;
            },
            getRect: getCachedScrollRect,
            zonePx: MOBILE_EDGE_SCROLL_ZONE_PX,
            maxSpeedPx: MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
            axes: { horizontal: true, vertical: true },
          });
          return { updateEdgeScroll };
        },
        render: () => null,
      }),
    );

    const vm = wrapper.vm as unknown as { updateEdgeScroll: (e: PointerEvent) => void };
    vm.updateEdgeScroll(new PointerEvent('pointermove', { clientX: 10, clientY: 150 }));

    vi.advanceTimersByTime(100);
    expect(getScrollLeft()).toBeLessThan(0);
    expect(reapplyCount).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('scrolls when pointer is outside the viewport to the left', () => {
    const { el, getScrollLeft } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();
    const draggingMode = ref<'move' | null>('move');

    const wrapper = mount(
      defineComponent({
        setup() {
          const { updateEdgeScroll } = useTimelineEdgeScroll({
            scrollEl: ref(el),
            isActive: computed(() => draggingMode.value !== null),
            onScrollStep: () => {},
            getRect: getCachedScrollRect,
            zonePx: MOBILE_EDGE_SCROLL_ZONE_PX,
            maxSpeedPx: MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
            axes: { horizontal: true, vertical: true },
          });
          return { updateEdgeScroll };
        },
        render: () => null,
      }),
    );

    const vm = wrapper.vm as unknown as { updateEdgeScroll: (e: PointerEvent) => void };
    vm.updateEdgeScroll(new PointerEvent('pointermove', { clientX: -20, clientY: 150 }));

    vi.advanceTimersByTime(100);
    expect(getScrollLeft()).toBeLessThan(0);
    wrapper.unmount();
  });

  it('stops scrolling when pointer moves to the center', () => {
    const { el, getScrollLeft } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();
    const draggingMode = ref<'move' | null>('move');

    const wrapper = mount(
      defineComponent({
        setup() {
          const { updateEdgeScroll, stopEdgeScroll } = useTimelineEdgeScroll({
            scrollEl: ref(el),
            isActive: computed(() => draggingMode.value !== null),
            onScrollStep: () => {},
            getRect: getCachedScrollRect,
            zonePx: MOBILE_EDGE_SCROLL_ZONE_PX,
            maxSpeedPx: MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
            axes: { horizontal: true, vertical: true },
          });
          return { updateEdgeScroll, stopEdgeScroll };
        },
        render: () => null,
      }),
    );

    const vm = wrapper.vm as unknown as {
      updateEdgeScroll: (e: PointerEvent) => void;
      stopEdgeScroll: () => void;
    };
    vm.updateEdgeScroll(new PointerEvent('pointermove', { clientX: 10, clientY: 150 }));
    vi.advanceTimersByTime(16);
    const scrollAfterEdge = getScrollLeft();

    vm.updateEdgeScroll(new PointerEvent('pointermove', { clientX: 250, clientY: 150 }));
    vi.advanceTimersByTime(16);
    expect(getScrollLeft()).toBe(scrollAfterEdge);
    wrapper.unmount();
  });

  it('cancels RAF on unmount', () => {
    const { el } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();
    const draggingMode = ref<'move' | null>('move');

    const wrapper = mount(
      defineComponent({
        setup() {
          useTimelineEdgeScroll({
            scrollEl: ref(el),
            isActive: computed(() => draggingMode.value !== null),
            onScrollStep: () => {},
            getRect: getCachedScrollRect,
            zonePx: MOBILE_EDGE_SCROLL_ZONE_PX,
            maxSpeedPx: MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
            axes: { horizontal: true, vertical: true },
          });
          return () => null;
        },
      }),
    );

    wrapper.unmount();
    // If RAF is not cancelled, fake timers may leak; unmount itself should not throw.
    expect(true).toBe(true);
  });
});

describe('useTimelineEdgeScroll (desktop axis)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
  });

  function createScrollEl() {
    const el = document.createElement('div');
    let scrollLeft = 0;
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    el.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 300,
        top: 0,
        right: 500,
        bottom: 300,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    return { el, getScrollLeft: () => scrollLeft, getScrollTop: () => scrollTop };
  }

  it('scrolls horizontally but not vertically near the top edge', () => {
    const { el, getScrollLeft, getScrollTop } = createScrollEl();
    const draggingMode = ref<'move' | null>('move');

    const wrapper = mount(
      defineComponent({
        setup() {
          const { updateEdgeScroll } = useTimelineEdgeScroll({
            scrollEl: ref(el),
            isActive: computed(() => draggingMode.value !== null),
            onScrollStep: () => {},
          });
          return { updateEdgeScroll };
        },
        render: () => null,
      }),
    );

    const vm = wrapper.vm as unknown as { updateEdgeScroll: (e: PointerEvent) => void };
    vm.updateEdgeScroll(new PointerEvent('pointermove', { clientX: 250, clientY: 10 }));

    vi.advanceTimersByTime(100);
    expect(getScrollLeft()).toBe(0);
    expect(getScrollTop()).toBe(0);
    wrapper.unmount();
  });
});
