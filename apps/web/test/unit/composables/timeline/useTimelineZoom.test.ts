/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineStore } from '~/stores/timeline.store';
import { ticksToPx } from '~/utils/timeline/geometry';

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});

vi.stubGlobal('cancelAnimationFrame', vi.fn());

describe('useTimelineZoom', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('applies cursor-anchored scroll after the timeline width has rendered', async () => {
    const timelineStore = useTimelineStore();
    const scrollEl = document.createElement('div');
    let maxScrollLeft = 200;
    let scrollLeft = 0;

    Object.defineProperty(scrollEl, 'scrollLeft', {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(maxScrollLeft, value));
      },
      configurable: true,
    });
    scrollEl.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 20,
        top: 0,
        right: 500,
        bottom: 20,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    timelineStore.setTimelineZoomExact(50);

    let handleZoomWheel: ReturnType<typeof useTimelineZoom>['handleZoomWheel'] | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          handleZoomWheel = useTimelineZoom({ scrollEl: ref(scrollEl) }).handleZoomWheel;
          return () => null;
        },
      }),
    );
    const anchorTimeTicks = 25_401_600_000_000;
    const anchorViewportX = 250;

    handleZoomWheel?.(20, { anchorTimeTicks, anchorViewportX });
    maxScrollLeft = 10_000;
    await nextTick();

    expect(scrollLeft).toBeCloseTo(
      ticksToPx(anchorTimeTicks, timelineStore.timelineZoom) - anchorViewportX,
      3,
    );
    expect(timelineStore.timelineScrollLeftPx).toBe(scrollLeft);
    wrapper.unmount();
  });

  it('reveals a playhead left of the viewport at the left edge while zooming', async () => {
    const timelineStore = useTimelineStore();
    const scrollEl = document.createElement('div');
    const maxScrollLeft = 10_000;
    let scrollLeft = 1_500;

    Object.defineProperty(scrollEl, 'scrollLeft', {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(maxScrollLeft, value));
      },
      configurable: true,
    });
    scrollEl.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 20,
        top: 0,
        right: 500,
        bottom: 20,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    timelineStore.setTimelineZoomExact(50);

    let handleZoomWheel: ReturnType<typeof useTimelineZoom>['handleZoomWheel'] | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          handleZoomWheel = useTimelineZoom({ scrollEl: ref(scrollEl) }).handleZoomWheel;
          return () => null;
        },
      }),
    );

    const playheadTimeTicks = 25_401_600_000_000;
    const anchorViewportX = ticksToPx(playheadTimeTicks, timelineStore.timelineZoom) - scrollLeft;

    expect(anchorViewportX).toBeLessThan(0);

    handleZoomWheel?.(7, { anchorTimeTicks: playheadTimeTicks, anchorViewportX });
    await nextTick();

    expect(scrollLeft).toBeCloseTo(ticksToPx(playheadTimeTicks, timelineStore.timelineZoom), 3);
    expect(timelineStore.timelineScrollLeftPx).toBe(scrollLeft);
    wrapper.unmount();
  });

  it('reveals a playhead right of the viewport at the right edge while zooming', async () => {
    const timelineStore = useTimelineStore();
    const scrollEl = document.createElement('div');
    const maxScrollLeft = 10_000;
    let scrollLeft = 0;

    Object.defineProperty(scrollEl, 'scrollLeft', {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(maxScrollLeft, value));
      },
      configurable: true,
    });
    scrollEl.getBoundingClientRect = () =>
      ({
        width: 500,
        height: 20,
        top: 0,
        right: 500,
        bottom: 20,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    timelineStore.setTimelineZoomExact(50);

    let handleZoomWheel: ReturnType<typeof useTimelineZoom>['handleZoomWheel'] | null = null;
    const wrapper = mount(
      defineComponent({
        setup() {
          handleZoomWheel = useTimelineZoom({ scrollEl: ref(scrollEl) }).handleZoomWheel;
          return () => null;
        },
      }),
    );

    const playheadTimeTicks = 25_401_600_000_000;
    const viewportWidth = 500;
    const anchorViewportX = ticksToPx(playheadTimeTicks, timelineStore.timelineZoom) - scrollLeft;

    expect(anchorViewportX).toBeGreaterThan(viewportWidth);

    handleZoomWheel?.(7, { anchorTimeTicks: playheadTimeTicks, anchorViewportX });
    await nextTick();

    expect(scrollLeft).toBeCloseTo(
      ticksToPx(playheadTimeTicks, timelineStore.timelineZoom) - viewportWidth,
      3,
    );
    expect(timelineStore.timelineScrollLeftPx).toBe(scrollLeft);
    wrapper.unmount();
  });
});
