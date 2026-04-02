/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, ref, computed, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import {
  timeUsToPx,
  pxToTimeUs,
  pxToDeltaUs,
  BASE_PX_PER_SECOND,
  computeAnchoredScrollLeft,
  useTimelineInteraction,
} from '~/composables/timeline/useTimelineInteraction';
import {
  computeSnappedStartUs,
  quantizeStartUsToFrames,
  pickBestSnapCandidateUs,
} from '~/utils/timeline/geometry';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';

describe('useTimelineInteraction', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('timeUsToPx should convert microseconds to pixels correctly', () => {
    // 1 second (1000000 us) should be BASE_PX_PER_SECOND at 1x zoom (slider position 50)
    expect(timeUsToPx(1_000_000, 50)).toBe(BASE_PX_PER_SECOND);
    // 0.5 second
    expect(timeUsToPx(500_000, 50)).toBe(BASE_PX_PER_SECOND / 2);
  });

  it('pxToTimeUs should convert pixels to microseconds correctly', () => {
    expect(pxToTimeUs(BASE_PX_PER_SECOND, 50)).toBe(1_000_000);
    expect(pxToTimeUs(BASE_PX_PER_SECOND / 2, 50)).toBe(500_000);
    // Should never return negative
    expect(pxToTimeUs(-10, 50)).toBe(0);
  });

  it('pxToDeltaUs should convert pixels to delta microseconds correctly', () => {
    expect(pxToDeltaUs(BASE_PX_PER_SECOND, 50)).toBe(1_000_000);
    // Delta CAN be negative
    expect(pxToDeltaUs(-BASE_PX_PER_SECOND, 50)).toBe(-1_000_000);
  });

  it('computeAnchoredScrollLeft should keep anchor time at same viewport position', () => {
    // At zoom 50, 1s => BASE_PX_PER_SECOND.
    // We want time=10s to stay at viewportX=100.
    const prevZoom = 50;
    const nextZoom = 60;
    const viewportWidth = 300;

    const anchorTimeUs = 10_000_000;
    const anchorViewportX = 100;

    const anchorPxAtPrevZoom = timeUsToPx(anchorTimeUs, prevZoom);
    const prevScrollLeft = Math.max(0, anchorPxAtPrevZoom - anchorViewportX);

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor: { anchorTimeUs, anchorViewportX },
    });

    const anchorPxAtNextZoom = timeUsToPx(anchorTimeUs, nextZoom);
    expect(anchorPxAtNextZoom - nextScrollLeft).toBeCloseTo(anchorViewportX, 6);
  });

  it('computeAnchoredScrollLeft should clamp negative scrollLeft to 0', () => {
    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 0,
      prevScrollLeft: 0,
      viewportWidth: 300,
      anchor: { anchorTimeUs: 0, anchorViewportX: 200 },
    });

    expect(nextScrollLeft).toBe(0);
  });

  it('computeSnappedStartUs should always quantize to frames when frame snapping is enabled', () => {
    const fps = 30;

    // Pick a target that is not on a frame boundary.
    const targetUs = 101_000;
    expect(targetUs).not.toBe(quantizeStartUsToFrames(targetUs, fps));

    const snapped = computeSnappedStartUs({
      rawStartUs: 123_456,
      draggingItemDurationUs: 1_000_000,
      fps,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsUs: [targetUs],
      enableFrameSnap: true,
      enableClipSnap: true,
      frameOffsetUs: 0,
    });

    expect(snapped).toBe(quantizeStartUsToFrames(snapped, fps));
  });

  it('computeSnappedStartUs should preserve frame offset when snapping (free clip offset is kept)', () => {
    const fps = 30;
    const frameUs = Math.round(1e6 / fps);

    // Simulate a clip that initially sits between frames (has offset).
    const frameOffsetUs = 7_000;
    expect(frameOffsetUs).toBeGreaterThan(0);

    const rawStartUs = frameUs * 10 + 12_345;

    const snapped = computeSnappedStartUs({
      rawStartUs,
      draggingItemDurationUs: 1_000_000,
      fps,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsUs: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetUs,
    });

    // When offset snapping is used, result should keep the same offset relative to frame grid.
    const base = Math.max(0, snapped - frameOffsetUs);
    expect(base).toBe(quantizeStartUsToFrames(base, fps));
    expect(snapped).toBe(base + frameOffsetUs);
  });

  it('pickBestSnapCandidateUs should snap to nearest marker edge within threshold', () => {
    const thresholdUs = 10_000;
    const zoneStartUs = 1_000_000;
    const zoneEndUs = zoneStartUs + 500_000;

    const rawUs = zoneEndUs + 2_000;
    const res = pickBestSnapCandidateUs({
      rawUs,
      thresholdUs,
      targetsUs: [zoneStartUs, zoneEndUs],
    });

    expect(res.snappedUs).toBe(zoneEndUs);
    expect(res.distUs).toBe(2_000);
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
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
            {
              kind: 'clip',
              id: 'clip-2',
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
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
});
