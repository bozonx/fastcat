/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineStore } from '~/stores/timeline.store';
import { timeUsToPx } from '~/utils/timeline/geometry';

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
    const anchorTimeUs = 100_000_000;
    const anchorViewportX = 250;

    handleZoomWheel?.(20, { anchorTimeUs, anchorViewportX });
    maxScrollLeft = 10_000;
    await nextTick();

    expect(scrollLeft).toBeCloseTo(
      timeUsToPx(anchorTimeUs, timelineStore.timelineZoom) - anchorViewportX,
      3,
    );
    expect(timelineStore.timelineScrollLeftPx).toBe(scrollLeft);
    wrapper.unmount();
  });
});
