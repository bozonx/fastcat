/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, ref, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';

import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineWheelHandler } from '~/composables/timeline/useTimelineWheelHandler';

vi.mock('~/composables/timeline/useTimelineZoom', () => ({
  useTimelineZoom: vi.fn(() => ({
    handleZoomWheel: vi.fn(),
    fitTimelineZoom: vi.fn(),
  })),
}));

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
});

vi.stubGlobal('cancelAnimationFrame', vi.fn());

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('useTimelineWheelHandler', () => {
  let mockHandleZoomWheel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());

    // Reset workspace store to defaults before each test
    Object.assign(
      mockWorkspaceStore.userSettings,
      JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
    );

    mockHandleZoomWheel = vi.fn();
    vi.mocked(useTimelineZoom).mockReturnValue({
      handleZoomWheel: mockHandleZoomWheel,
      fitTimelineZoom: vi.fn(),
    });
  });

  it('zooms toward the playhead when zoom_horizontal_to_playhead is active', async () => {
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_horizontal_to_playhead';
    mockWorkspaceStore.userSettings.mouse.timeline.wheelShift = 'zoom_horizontal_to_playhead';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 100,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(horizontalEl, 'clientWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });

    const videoEl = document.createElement('div');
    videoEl.className = 'video-tracks-scroll';
    videoEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 200,
        width: 500,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const TestComp = defineComponent({
      setup() {
        useTimelineWheelHandler({
          horizontalScrollEl: ref(horizontalEl),
          videoScrollEl: ref(videoEl),
          audioScrollEl: ref(document.createElement('div')),
          rulerContainerRef: ref(document.createElement('div')),
          scrollEl: ref(document.createElement('div')),
          tracks: ref([]),
        });
        return () => null;
      },
    });

    const wrapper = mount(TestComp);

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();

    expect(mockHandleZoomWheel).toHaveBeenCalledTimes(1);

    const [, anchor] = mockHandleZoomWheel.mock.calls[0];
    expect(anchor.anchorTimeUs).toBe(0);

    wrapper.unmount();
  });

  it('zooms toward a non-zero playhead position', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    timelineStore.duration = 10_000_000;
    timelineStore.setCurrentTimeUs(5_000_000);

    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_horizontal_to_playhead';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 100,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(horizontalEl, 'clientWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });

    const videoEl = document.createElement('div');
    videoEl.className = 'video-tracks-scroll';
    videoEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 200,
        width: 500,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const TestComp = defineComponent({
      setup() {
        useTimelineWheelHandler({
          horizontalScrollEl: ref(horizontalEl),
          videoScrollEl: ref(videoEl),
          audioScrollEl: ref(document.createElement('div')),
          rulerContainerRef: ref(document.createElement('div')),
          scrollEl: ref(document.createElement('div')),
          tracks: ref([]),
        });
        return () => null;
      },
    });

    const wrapper = mount(TestComp);

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();

    expect(mockHandleZoomWheel).toHaveBeenCalledTimes(1);

    const [, anchor] = mockHandleZoomWheel.mock.calls[0];
    expect(anchor.anchorTimeUs).toBe(5_000_000);

    wrapper.unmount();
  });
});
