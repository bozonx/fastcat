/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { useMobileTimelineScroll } from '~/composables/timeline/useMobileTimelineScroll';

vi.mock('@vueuse/core', () => ({
  useElementSize: (elRef: any) => ({
    width: computed(() => (elRef.value ? elRef.value.clientWidth : 0)),
  }),
}));

vi.mock('~/utils/timeline/geometry', () => ({
  computeTimelineScrollLeftForPlayhead: vi.fn(() => 250),
}));

const mockTimelineStore = {
  timelineScrollLeftPx: 0,
  scrollToPlayheadRequest: 0,
};

describe('useMobileTimelineScroll', () => {
  beforeEach(() => {
    mockTimelineStore.timelineScrollLeftPx = 0;
    mockTimelineStore.scrollToPlayheadRequest = 0;
  });

  it('exposes reactive viewport width from useElementSize', () => {
    const scrollEl = ref(document.createElement('div'));
    Object.defineProperty(scrollEl.value, 'clientWidth', { value: 400 });
    document.body.appendChild(scrollEl.value);

    const { scrollViewportWidth } = useMobileTimelineScroll({
      scrollEl,
      playheadPx: computed(() => 100),
      timelineStore: mockTimelineStore as any,
    });

    expect(scrollViewportWidth.value).toBe(400);
    document.body.removeChild(scrollEl.value);
  });

  it('syncs scroll position to the store on scroll', async () => {
    const scrollEl = ref(document.createElement('div'));
    scrollEl.value.style.width = '300px';
    scrollEl.value.scrollLeft = 120;
    document.body.appendChild(scrollEl.value);

    useMobileTimelineScroll({
      scrollEl,
      playheadPx: computed(() => 100),
      timelineStore: mockTimelineStore as any,
    });

    scrollEl.value.dispatchEvent(new Event('scroll'));
    expect(mockTimelineStore.timelineScrollLeftPx).toBe(120);
    document.body.removeChild(scrollEl.value);
  });

  it('scrolls playhead into view when scrollToPlayheadRequest changes', async () => {
    const scrollEl = ref(document.createElement('div'));
    scrollEl.value.style.width = '300px';
    document.body.appendChild(scrollEl.value);

    const { computeTimelineScrollLeftForPlayhead } = await import('~/utils/timeline/geometry');

    useMobileTimelineScroll({
      scrollEl,
      playheadPx: computed(() => 100),
      timelineStore: mockTimelineStore as any,
    });

    mockTimelineStore.scrollToPlayheadRequest += 1;
    await new Promise((r) => setTimeout(r, 10));

    expect(computeTimelineScrollLeftForPlayhead).toHaveBeenCalled();
    document.body.removeChild(scrollEl.value);
  });
});
