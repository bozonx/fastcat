/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useTimelineMarquee } from '~/composables/timeline/useTimelineMarquee';
import type { TimelineTrack } from '~/timeline/types';
import { timelineUs } from '../../utils/timeline-time';

const mockTimelineStore = vi.hoisted(() => ({
  timelineZoom: 50,
  clearSelection: vi.fn(),
  selectTimelineItems: vi.fn(),
}));

const mockSelectionStore = vi.hoisted(() => ({
  clearSelection: vi.fn(),
  selectTimelineItems: vi.fn(),
}));

const mockProjectStore = vi.hoisted(() => ({
  currentView: 'cut',
}));

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));

describe('useTimelineMarquee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineZoom = 50;
    mockProjectStore.currentView = 'cut';
    // The live marquee selection is coalesced through requestAnimationFrame; run
    // it synchronously so the existing assertions observe the result immediately.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects clips under the visible marquee when timeline content is horizontally translated', async () => {
    let startMarquee: (event: PointerEvent) => void = () => {};
    let container: Ref<HTMLElement | null> | null = null;

    const tracks = ref<TimelineTrack[]>([
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-visible',
            kind: 'clip',
            timelineRange: { startUs: timelineUs(61_000_000), durationUs: timelineUs(2_000_000) },
          },
        ],
      } as TimelineTrack,
    ]);
    const trackHeights = ref<Record<string, number>>({ 'track-1': 40 });

    const TestComponent = defineComponent({
      setup() {
        container = ref<HTMLElement | null>(null);
        const marquee = useTimelineMarquee(container, tracks, trackHeights);
        startMarquee = marquee.startMarquee;
        return () => h('div', { ref: container });
      },
    });

    const wrapper = mount(TestComponent);
    const element = wrapper.element as HTMLElement;
    element.getBoundingClientRect = () =>
      ({
        left: -500,
        top: 0,
        right: 1500,
        bottom: 200,
        width: 2000,
        height: 200,
        x: -500,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    startMarquee(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 20 }));
    await nextTick();

    expect(mockTimelineStore.selectTimelineItems).toHaveBeenCalledWith(['clip-visible']);
    expect(mockSelectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-visible' },
    ]);

    window.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, clientX: 130, clientY: 20 }),
    );
    wrapper.unmount();
  });
});
