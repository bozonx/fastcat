/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useMobileTimelineZoom } from '~/composables/timeline/useMobileTimelineZoom';
import { useTimelineStore } from '~/stores/timeline.store';

describe('useMobileTimelineZoom', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function createScrollEl() {
    const el = document.createElement('div');
    let scrollLeft = 0;
    Object.defineProperty(el, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, 'clientWidth', {
      get: () => 500,
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
    return { el, getScrollLeft: () => scrollLeft };
  }

  it('zooms in on two-finger pinch', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.setTimelineZoomExact(50);

    const { el, getScrollLeft } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();

    let api: ReturnType<typeof useMobileTimelineZoom> | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useMobileTimelineZoom(ref(el), getCachedScrollRect);
          return () => null;
        },
      }),
    );

    const touchStart = new TouchEvent('touchstart', {
      touches: [
        new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 }),
        new Touch({ identifier: 2, target: el, clientX: 200, clientY: 100 }),
      ],
    });
    api!.onTouchStart(touchStart);

    const touchMove = new TouchEvent('touchmove', {
      touches: [
        new Touch({ identifier: 1, target: el, clientX: 90, clientY: 100 }),
        new Touch({ identifier: 2, target: el, clientX: 210, clientY: 100 }),
      ],
      cancelable: true,
    });
    api!.onTouchMove(touchMove);

    await nextTick();
    expect(timelineStore.timelineZoom).toBeGreaterThan(50);
    wrapper.unmount();
  });

  it('adds and removes wheel listener on mount/unmount', async () => {
    const { el } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();
    const addSpy = vi.spyOn(el, 'addEventListener');
    const removeSpy = vi.spyOn(el, 'removeEventListener');

    const wrapper = mount(
      defineComponent({
        setup() {
          useMobileTimelineZoom(ref(el), getCachedScrollRect);
          return () => null;
        },
      }),
    );
    await nextTick();

    expect(addSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
  });

  it('anchors scroll to pinch midpoint after zoom', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.setTimelineZoomExact(50);

    const { el, getScrollLeft } = createScrollEl();
    const getCachedScrollRect = (e: HTMLElement) => e.getBoundingClientRect();

    let api: ReturnType<typeof useMobileTimelineZoom> | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useMobileTimelineZoom(ref(el), getCachedScrollRect);
          return () => null;
        },
      }),
    );

    api!.onTouchStart(
      new TouchEvent('touchstart', {
        touches: [
          new Touch({ identifier: 1, target: el, clientX: 100, clientY: 100 }),
          new Touch({ identifier: 2, target: el, clientX: 200, clientY: 100 }),
        ],
      }),
    );

    api!.onTouchMove(
      new TouchEvent('touchmove', {
        touches: [
          new Touch({ identifier: 1, target: el, clientX: 50, clientY: 100 }),
          new Touch({ identifier: 2, target: el, clientX: 250, clientY: 100 }),
        ],
        cancelable: true,
      }),
    );

    await nextTick();
    // scrollLeft should have been adjusted so the midpoint stays anchored
    expect(getScrollLeft()).not.toBe(0);
    wrapper.unmount();
  });
});
