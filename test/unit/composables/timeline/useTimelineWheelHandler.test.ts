/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, ref, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';

import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineWheelHandler } from '~/composables/timeline/useTimelineWheelHandler';
import { pxPerSecondToZoom, pxToTimeTicks } from '~/utils/timeline/geometry';
import { TICKS_PER_SECOND } from '~/utils/time';

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
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
    presets: {
      custom: [],
      defaultText: '',
    },
  },
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
    expect(anchor.anchorTimeTicks).toBe(0);

    wrapper.unmount();
  });

  it('zooms toward a non-zero playhead position', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    timelineStore.duration = 2_540_160_000_000;
    timelineStore.setCurrentTimeTicks(1_270_080_000_000);

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
    expect(anchor.anchorTimeTicks).toBe(1_270_080_000_000);

    wrapper.unmount();
  });

  it('clamps cursor zoom-out at the timeline fit boundary', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    const durationTicks = 100_000_000;
    const viewportWidth = 500;
    const minCursorZoom = pxPerSecondToZoom(viewportWidth / (durationTicks / 1e6));

    timelineStore.duration = durationTicks * 254_016;
    timelineStore.setTimelineZoomExact(minCursorZoom + 0.4);
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_horizontal';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(horizontalEl, 'clientWidth', {
      value: viewportWidth,
      writable: true,
      configurable: true,
    });

    const videoEl = document.createElement('div');
    videoEl.className = 'video-tracks-scroll';
    videoEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: 200,
        width: viewportWidth,
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

    videoEl.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 20,
        clientX: 120,
        bubbles: true,
        cancelable: true,
      }),
    );

    await nextTick();

    expect(mockHandleZoomWheel).toHaveBeenCalledTimes(1);

    const [zoomDelta, anchor] = mockHandleZoomWheel.mock.calls[0];
    expect(zoomDelta).toBeCloseTo(minCursorZoom - (minCursorZoom + 0.4), 6);
    expect(anchor.anchorViewportX).toBe(viewportWidth / 2);
    expect(anchor.anchorTimeTicks).toBe((durationTicks / 2) * 254_016);

    wrapper.unmount();
  });

  it('does not clamp playhead zoom-out at the cursor zoom boundary', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    const durationTicks = 100_000_000;
    const viewportWidth = 500;
    const minCursorZoom = pxPerSecondToZoom(viewportWidth / (durationTicks / 1e6));

    timelineStore.duration = durationTicks * 254_016;
    timelineStore.setCurrentTimeTicks(10_160_640_000_000);
    timelineStore.setTimelineZoomExact(minCursorZoom + 0.4);
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_horizontal_to_playhead';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(horizontalEl, 'clientWidth', {
      value: viewportWidth,
      writable: true,
      configurable: true,
    });

    const videoEl = document.createElement('div');
    videoEl.className = 'video-tracks-scroll';
    videoEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: 200,
        width: viewportWidth,
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

    videoEl.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 20,
        bubbles: true,
        cancelable: true,
      }),
    );

    await nextTick();

    expect(mockHandleZoomWheel).toHaveBeenCalledTimes(1);

    const [zoomDelta, anchor] = mockHandleZoomWheel.mock.calls[0];
    expect(zoomDelta).toBe(-2);
    expect(anchor.anchorTimeTicks).toBe(10_160_640_000_000);

    wrapper.unmount();
  });

  it('uses the cursor anchor when zooming in from the cursor zoom boundary', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    const durationTicks = 100_000_000;
    const viewportWidth = 500;
    const cursorX = 120;
    const minCursorZoom = pxPerSecondToZoom(viewportWidth / (durationTicks / 1e6));

    timelineStore.duration = durationTicks * 254_016;
    timelineStore.setTimelineZoomExact(minCursorZoom);
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_horizontal';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(horizontalEl, 'clientWidth', {
      value: viewportWidth,
      writable: true,
      configurable: true,
    });

    const videoEl = document.createElement('div');
    videoEl.className = 'video-tracks-scroll';
    videoEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: 200,
        width: viewportWidth,
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
      deltaY: -20,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(wheelEvent, 'clientX', {
      value: cursorX,
      configurable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();

    expect(mockHandleZoomWheel).toHaveBeenCalledTimes(1);

    const [zoomDelta, anchor] = mockHandleZoomWheel.mock.calls[0];
    expect(zoomDelta).toBe(2);
    expect(anchor.anchorViewportX).toBe(cursorX);
    expect(anchor.anchorTimeTicks).toBe(pxToTimeTicks(cursorX, minCursorZoom));

    wrapper.unmount();
  });

  // Helper to mount a minimal timeline wheel handler
  function mountHandler(opts?: { tracks?: { id: string; kind: string }[] }) {
    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 0,
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

    const audioEl = document.createElement('div');
    audioEl.className = 'audio-tracks-scroll';

    const rulerEl = document.createElement('div');
    rulerEl.className = 'ruler-container';
    rulerEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 30,
        width: 500,
        height: 30,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const scrollEl = document.createElement('div');
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    });

    const tracksRef = ref(opts?.tracks ?? []);

    const TestComp = defineComponent({
      setup() {
        useTimelineWheelHandler({
          horizontalScrollEl: ref(horizontalEl),
          videoScrollEl: ref(videoEl),
          audioScrollEl: ref(audioEl),
          rulerContainerRef: ref(rulerEl),
          scrollEl: ref(scrollEl),
          tracks: tracksRef,
        });
        return () => null;
      },
    });

    const wrapper = mount(TestComp);
    return { wrapper, horizontalEl, videoEl, audioEl, rulerEl, scrollEl };
  }

  it('prevents default and does nothing for "none" wheel action', async () => {
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'none';
    const { wrapper, videoEl } = mountHandler();

    const wheelEvent = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(wheelEvent, 'preventDefault');
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();
    expect(preventSpy).toHaveBeenCalled();
    expect(mockHandleZoomWheel).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('scrolls vertically for "scroll_vertical" action via secondary wheel', async () => {
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'scroll_vertical';
    const { wrapper, videoEl } = mountHandler();

    // Secondary wheel (deltaX > deltaY) bypasses native scroll check
    const wheelEvent = new WheelEvent('wheel', {
      deltaX: 20,
      deltaY: 5,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(wheelEvent, 'preventDefault');
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();
    // preventDefault is called when the handler processes scroll_vertical programmatically
    expect(preventSpy).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('scrolls horizontally for "scroll_horizontal" action', async () => {
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'scroll_horizontal';
    const { wrapper, horizontalEl, videoEl } = mountHandler();

    const scrollBySpy = vi.spyOn(horizontalEl, 'scrollBy');
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();
    expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ left: 10 }));

    wrapper.unmount();
  });

  it('seeks by frame for "seek_frame" action', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    timelineStore.duration = 60 * TICKS_PER_SECOND;
    timelineStore.setCurrentTimeTicks(5 * TICKS_PER_SECOND);
    const setCurrentTimeTicksSpy = vi.spyOn(timelineStore, 'setCurrentTimeTicks');

    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'seek_frame';
    const { wrapper, videoEl } = mountHandler();

    videoEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));

    await nextTick();
    expect(setCurrentTimeTicksSpy).toHaveBeenCalled();
    const seekDelta = setCurrentTimeTicksSpy.mock.calls[0]![0] - 5 * TICKS_PER_SECOND;
    // One frame forward (deltaY > 0)
    expect(seekDelta).toBeGreaterThan(0);
    expect(seekDelta).toBeLessThanOrEqual(TICKS_PER_SECOND);

    wrapper.unmount();
  });

  it('seeks by second for "seek_second" action', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    timelineStore.duration = 60 * TICKS_PER_SECOND;
    timelineStore.setCurrentTimeTicks(5 * TICKS_PER_SECOND);
    const setCurrentTimeTicksSpy = vi.spyOn(timelineStore, 'setCurrentTimeTicks');

    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'seek_second';
    const { wrapper, videoEl } = mountHandler();

    videoEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));

    await nextTick();
    expect(setCurrentTimeTicksSpy).toHaveBeenCalled();
    const seekDelta = setCurrentTimeTicksSpy.mock.calls[0]![0] - 5 * TICKS_PER_SECOND;
    expect(seekDelta).toBe(TICKS_PER_SECOND);

    wrapper.unmount();
  });

  it('resizes track height for "resize_track" action', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    const { trackHeights } = await import('~/stores/timeline.store').then(() => {
      return { trackHeights: (timelineStore as any).trackHeights };
    });

    const trackId = 'v1';
    if (timelineStore.trackHeights) {
      timelineStore.trackHeights[trackId] = 80;
    }

    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'resize_track';
    const { wrapper, videoEl } = mountHandler({ tracks: [{ id: trackId, kind: 'video' }] });

    const trackEl = document.createElement('div');
    trackEl.setAttribute('data-track-id', trackId);
    Object.defineProperty(trackEl, 'closest', {
      value: vi.fn((sel: string) => (sel === '[data-track-id]' ? trackEl : null)),
      configurable: true,
    });

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 20,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(wheelEvent, 'target', {
      value: trackEl,
      configurable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();
    if (timelineStore.trackHeights) {
      expect(timelineStore.trackHeights[trackId]).not.toBe(80);
    }

    wrapper.unmount();
  });

  it('zooms vertically for "zoom_vertical" action on video tracks', async () => {
    const { useTimelineStore } = await import('~/stores/timeline.store');
    const timelineStore = useTimelineStore();
    const trackId = 'v1';
    if (timelineStore.trackHeights) {
      timelineStore.trackHeights[trackId] = 80;
    }

    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'zoom_vertical';
    const { wrapper, videoEl } = mountHandler({ tracks: [{ id: trackId, kind: 'video' }] });

    videoEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true }));

    await nextTick();
    if (timelineStore.trackHeights) {
      // deltaY > 0 means zoom out (shrink)
      expect(timelineStore.trackHeights[trackId]).toBeLessThan(80);
    }

    wrapper.unmount();
  });

  it('handles ruler category wheel events', async () => {
    mockWorkspaceStore.userSettings.mouse.ruler.wheel = 'zoom_horizontal_to_playhead';
    const { wrapper, rulerEl } = mountHandler();

    rulerEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));

    await nextTick();
    expect(mockHandleZoomWheel).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it('handles trackHeaders category wheel events via labels container', async () => {
    mockWorkspaceStore.userSettings.mouse.trackHeaders.wheel = 'zoom_horizontal_to_playhead';

    const horizontalEl = document.createElement('div');
    Object.defineProperty(horizontalEl, 'scrollLeft', {
      value: 0,
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

    const labelsEl = document.createElement('div');
    labelsEl.className = 'timeline-labels-container';
    labelsEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const scrollEl = document.createElement('div');
    const rulerEl = document.createElement('div');

    const TestComp = defineComponent({
      setup() {
        useTimelineWheelHandler({
          horizontalScrollEl: ref(horizontalEl),
          videoScrollEl: ref(videoEl),
          audioScrollEl: ref(document.createElement('div')),
          videoLabelsScrollEl: ref(labelsEl),
          rulerContainerRef: ref(rulerEl),
          scrollEl: ref(scrollEl),
          tracks: ref([]),
        });
        return () => null;
      },
    });

    const wrapper = mount(TestComp);

    labelsEl.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }),
    );

    await nextTick();
    expect(mockHandleZoomWheel).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it('uses wheelShift when layer1 modifier is active', async () => {
    mockWorkspaceStore.userSettings.hotkeys.layer1 = 'Shift';
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'none';
    mockWorkspaceStore.userSettings.mouse.timeline.wheelShift = 'zoom_horizontal_to_playhead';

    const { wrapper, videoEl } = mountHandler();

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(wheelEvent, 'shiftKey', {
      value: true,
      configurable: true,
    });
    videoEl.dispatchEvent(wheelEvent);

    await nextTick();
    expect(mockHandleZoomWheel).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it('uses wheelSecondary for horizontal wheel (secondary)', async () => {
    mockWorkspaceStore.userSettings.mouse.timeline.wheel = 'none';
    mockWorkspaceStore.userSettings.mouse.timeline.wheelSecondary = 'zoom_horizontal_to_playhead';

    const { wrapper, videoEl } = mountHandler();

    // Secondary wheel: deltaX > deltaY
    videoEl.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: 20,
        deltaY: 5,
        bubbles: true,
        cancelable: true,
      }),
    );

    await nextTick();
    expect(mockHandleZoomWheel).toHaveBeenCalledOnce();

    wrapper.unmount();
  });
});
