/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, ref, computed, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import {
  ticksToPx,
  pxToTimeTicks,
  pxToDeltaTicks,
  BASE_PX_PER_SECOND,
  computeAnchoredScrollLeft,
  computeTimelinePlaybackAutoScrollLeft,
  computeSnappedStartTicks,
  quantizeStartTicksToFrames,
  pickBestSnapCandidateTicks,
} from '~/utils/timeline/geometry';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { TICKS_PER_SECOND } from '~/utils/time';

describe('useTimelineInteraction', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('ticksToPx should convert ticks to pixels correctly', () => {
    // 1 second (1000000 us) should be BASE_PX_PER_SECOND at 1x zoom (slider position 50)
    expect(ticksToPx(TICKS_PER_SECOND, 50)).toBe(BASE_PX_PER_SECOND);
    // 0.5 second
    expect(ticksToPx(TICKS_PER_SECOND / 2, 50)).toBe(BASE_PX_PER_SECOND / 2);
  });

  it('pxToTimeTicks should convert pixels to microseconds correctly', () => {
    expect(pxToTimeTicks(BASE_PX_PER_SECOND, 50)).toBe(TICKS_PER_SECOND);
    expect(pxToTimeTicks(BASE_PX_PER_SECOND / 2, 50)).toBe(TICKS_PER_SECOND / 2);
    // Should never return negative
    expect(pxToTimeTicks(-10, 50)).toBe(0);
  });

  it('pxToDeltaTicks should convert pixels to delta microseconds correctly', () => {
    expect(pxToDeltaTicks(BASE_PX_PER_SECOND, 50)).toBe(TICKS_PER_SECOND);
    // Delta CAN be negative
    expect(pxToDeltaTicks(-BASE_PX_PER_SECOND, 50)).toBe(-TICKS_PER_SECOND);
  });

  it('computeAnchoredScrollLeft should keep anchor time at same viewport position', () => {
    // At zoom 50, 1s => BASE_PX_PER_SECOND.
    // We want time=10s to stay at viewportX=100.
    const prevZoom = 50;
    const nextZoom = 60;
    const viewportWidth = 300;

    const anchorTimeTicks = 10 * TICKS_PER_SECOND;
    const anchorViewportX = 100;

    const anchorPxAtPrevZoom = ticksToPx(anchorTimeTicks, prevZoom);
    const prevScrollLeft = Math.max(0, anchorPxAtPrevZoom - anchorViewportX);

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor: { anchorTimeTicks, anchorViewportX },
    });

    const anchorPxAtNextZoom = ticksToPx(anchorTimeTicks, nextZoom);
    expect(anchorPxAtNextZoom - nextScrollLeft).toBeCloseTo(anchorViewportX, 6);
  });

  it('computeAnchoredScrollLeft should clamp negative scrollLeft to 0', () => {
    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 0,
      prevScrollLeft: 0,
      viewportWidth: 300,
      anchor: { anchorTimeTicks: 0, anchorViewportX: 200 },
    });

    expect(nextScrollLeft).toBe(0);
  });

  it('computeTimelinePlaybackAutoScrollLeft should not scroll inside the safe viewport area', () => {
    const nextScrollLeft = computeTimelinePlaybackAutoScrollLeft({
      playheadPx: 840,
      scrollLeft: 0,
      viewportWidth: 1000,
      maxScrollLeft: 5000,
    });

    expect(nextScrollLeft).toBeNull();
  });

  it('computeTimelinePlaybackAutoScrollLeft should place the playhead near the left working area', () => {
    const nextScrollLeft = computeTimelinePlaybackAutoScrollLeft({
      playheadPx: 900,
      scrollLeft: 0,
      viewportWidth: 1000,
      maxScrollLeft: 5000,
    });

    expect(nextScrollLeft).toBe(600);
  });

  it('computeTimelinePlaybackAutoScrollLeft should clamp to the available scroll range', () => {
    const nextScrollLeft = computeTimelinePlaybackAutoScrollLeft({
      playheadPx: 4900,
      scrollLeft: 4000,
      viewportWidth: 1000,
      maxScrollLeft: 4200,
    });

    expect(nextScrollLeft).toBe(4200);
  });

  it('computeSnappedStartTicks preserves an exact clip boundary over frame snapping', () => {
    const fps = 30;

    // Pick a target that is not on a frame boundary.
    const targetTicks = TICKS_PER_SECOND + 1;
    expect(targetTicks).not.toBe(quantizeStartTicksToFrames(targetTicks, fps));

    const snapped = computeSnappedStartTicks({
      rawStartTicks: targetTicks + 100,
      draggingItemDurationTicks: TICKS_PER_SECOND,
      fps,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsTicks: [targetTicks],
      enableFrameSnap: true,
      enableClipSnap: true,
      frameOffsetTicks: 0,
    });

    expect(snapped).toBe(targetTicks);
  });

  it('computeSnappedStartTicks should preserve frame offset when snapping (free clip offset is kept)', () => {
    const fps = 30;
    const frameTicks = Math.round(TICKS_PER_SECOND / fps);

    // Simulate a clip that initially sits between frames (has offset).
    const frameOffsetTicks = 7_000;
    expect(frameOffsetTicks).toBeGreaterThan(0);

    const rawStartTicks = frameTicks * 10 + 12_345;

    const snapped = computeSnappedStartTicks({
      rawStartTicks,
      draggingItemDurationTicks: TICKS_PER_SECOND,
      fps,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsTicks: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetTicks,
    });

    // When offset snapping is used, result should keep the same offset relative to frame grid.
    const base = Math.max(0, snapped - frameOffsetTicks);
    expect(base).toBe(quantizeStartTicksToFrames(base, fps));
    expect(snapped).toBe(base + frameOffsetTicks);
  });

  it('pickBestSnapCandidateTicks should snap to nearest marker edge within threshold', () => {
    const thresholdTicks = 10_000;
    const zoneStartTicks = 1_000_000;
    const zoneEndTicks = zoneStartTicks + 500_000;

    const rawTicks = zoneEndTicks + 2_000;
    const res = pickBestSnapCandidateTicks({
      rawTicks,
      thresholdTicks,
      targetsTicks: [zoneStartTicks, zoneEndTicks],
    });

    expect(res.snappedTicks).toBe(zoneEndTicks);
    expect(res.distTicks).toBe(2_000);
  });

  it('selectItem should sync selectionStore with the current click immediately', async () => {
    const scrollEl = ref<HTMLElement | null>(null);
    const timelineStore = useTimelineStore() as any;
    const selectionStore = useSelectionStore();

    timelineStore.timelineDoc = {
      timebase: { fps: 25 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [
            {
              kind: 'clip',
              id: 'clip-1',
              timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
            {
              kind: 'clip',
              id: 'clip-2',
              timelineRange: { startTicks: 1_000_000, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectedItemIds = ['clip-1'];

    let selectItemHandler: (event: PointerEvent, itemId: string) => void = () => {};

    const TestComp = defineComponent({
      setup() {
        const api = useTimelineInteraction(
          scrollEl,
          computed(() => timelineStore.timelineDoc.tracks),
        );
        selectItemHandler = api.selectItem;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    selectItemHandler(
      {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      } as PointerEvent,
      'clip-2',
    );
    await nextTick();

    expect(timelineStore.selectedItemIds).toEqual(['clip-2']);
    expect(selectionStore.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-2',
    });

    wrapper.unmount();
  });

  it('mobile re-tap on the selected clip should keep clip selection instead of switching to track', async () => {
    const scrollEl = ref<HTMLElement | null>(null);
    const timelineStore = useTimelineStore() as any;
    const selectionStore = useSelectionStore();

    timelineStore.timelineDoc = {
      timebase: { fps: 25 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [
            {
              kind: 'clip',
              id: 'clip-1',
              timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectedItemIds = ['clip-1'];
    timelineStore.selectedTrackId = null;
    selectionStore.selectTimelineItem('v1', 'clip-1');

    let selectItemHandler: (event: PointerEvent, itemId: string) => void = () => {};

    const TestComp = defineComponent({
      setup() {
        const api = useTimelineInteraction(
          scrollEl,
          computed(() => timelineStore.timelineDoc.tracks),
        );
        selectItemHandler = api.selectItem;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    selectItemHandler(
      {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        pointerType: 'touch',
      } as PointerEvent,
      'clip-1',
    );
    await nextTick();

    expect(timelineStore.selectedItemIds).toEqual(['clip-1']);
    expect(timelineStore.selectedTrackId).toBeNull();
    expect(selectionStore.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-1',
    });

    wrapper.unmount();
  });

  it('desktop re-click on the selected clip should keep clip selection instead of switching to track', async () => {
    const scrollEl = ref<HTMLElement | null>(null);
    const timelineStore = useTimelineStore() as any;
    const selectionStore = useSelectionStore();

    timelineStore.timelineDoc = {
      timebase: { fps: 25 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [
            {
              kind: 'clip',
              id: 'clip-1',
              timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectedItemIds = ['clip-1'];
    timelineStore.selectedTrackId = null;
    selectionStore.selectTimelineItem('v1', 'clip-1');

    let selectItemHandler: (event: PointerEvent, itemId: string) => void = () => {};

    const TestComp = defineComponent({
      setup() {
        const api = useTimelineInteraction(
          scrollEl,
          computed(() => timelineStore.timelineDoc.tracks),
        );
        selectItemHandler = api.selectItem;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    selectItemHandler(
      {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        pointerType: 'mouse',
      } as PointerEvent,
      'clip-1',
    );
    await nextTick();

    expect(timelineStore.selectedItemIds).toEqual(['clip-1']);
    expect(timelineStore.selectedTrackId).toBeNull();
    expect(selectionStore.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-1',
    });

    wrapper.unmount();
  });

  it('mobile tap on another clip should switch selection to that clip', async () => {
    const scrollEl = ref<HTMLElement | null>(null);
    const timelineStore = useTimelineStore() as any;
    const selectionStore = useSelectionStore();

    timelineStore.timelineDoc = {
      timebase: { fps: 25 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [
            {
              kind: 'clip',
              id: 'clip-1',
              timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
            {
              kind: 'clip',
              id: 'clip-2',
              timelineRange: { startTicks: 1_000_000, durationTicks: 1_000_000 },
              sourceRange: { startTicks: 0, durationTicks: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectedItemIds = ['clip-1'];
    timelineStore.selectedTrackId = null;
    selectionStore.selectTimelineItem('v1', 'clip-1');

    let selectItemHandler: (event: PointerEvent, itemId: string) => void = () => {};

    const TestComp = defineComponent({
      setup() {
        const api = useTimelineInteraction(
          scrollEl,
          computed(() => timelineStore.timelineDoc.tracks),
        );
        selectItemHandler = api.selectItem;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    selectItemHandler(
      {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        pointerType: 'touch',
      } as PointerEvent,
      'clip-2',
    );
    await nextTick();

    expect(timelineStore.selectedItemIds).toEqual(['clip-2']);
    expect(timelineStore.selectedTrackId).toBeNull();
    expect(selectionStore.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-2',
    });

    wrapper.unmount();
  });

  it('updates current time in trim mode using scroller geometry without changing pointer semantics', async () => {
    const scrollEl = ref<HTMLElement | null>(null);
    const timelineStore = useTimelineStore() as any;

    timelineStore.timelineZoom = 50;
    timelineStore.isTrimModeActive = true;
    timelineStore.setCurrentTimeTicks = vi.fn();
    timelineStore.timelineDoc = {
      timebase: { fps: 25 },
      tracks: [],
    };

    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'scrollLeft', {
      value: 120,
      configurable: true,
      writable: true,
    });
    scroller.getBoundingClientRect = vi.fn(() => ({
      left: 20,
      top: 0,
      right: 320,
      bottom: 100,
      width: 300,
      height: 100,
      x: 20,
      y: 0,
      toJSON: () => ({}),
    }));
    scrollEl.value = scroller;

    let pointerMoveHandler: (event: PointerEvent) => void = () => {};
    let pointerUpHandler: (event?: PointerEvent) => void = () => {};

    const TestComp = defineComponent({
      setup() {
        const api = useTimelineInteraction(
          scrollEl,
          computed(() => timelineStore.timelineDoc.tracks),
        );
        pointerMoveHandler = api.onGlobalPointerMove;
        pointerUpHandler = api.onGlobalPointerUp;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComp);

    pointerMoveHandler({ clientX: 70 } as PointerEvent);

    expect(timelineStore.setCurrentTimeTicks).toHaveBeenCalledWith(pxToTimeTicks(170, 50));
    expect(scroller.getBoundingClientRect).toHaveBeenCalledTimes(1);

    pointerMoveHandler({ clientX: 90 } as PointerEvent);

    expect(timelineStore.setCurrentTimeTicks).toHaveBeenLastCalledWith(pxToTimeTicks(190, 50));
    expect(scroller.getBoundingClientRect).toHaveBeenCalledTimes(1);

    pointerUpHandler();
    pointerMoveHandler({ clientX: 110 } as PointerEvent);

    expect(timelineStore.setCurrentTimeTicks).toHaveBeenLastCalledWith(pxToTimeTicks(210, 50));
    expect(scroller.getBoundingClientRect).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });
});
