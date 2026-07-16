import { TICKS_PER_SECOND } from '~/utils/time';
import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useEventListener } from '@vueuse/core';
import type { FastCatUserSettings } from '~/utils/settings/defaults';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxPerSecondToZoom, pxToTimeTicks, ticksToPx } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { getWheelDelta, isSecondaryWheel } from '~/utils/mouse';
import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import type { TimelineTrack } from '~/timeline/types';

export interface UseTimelineWheelHandlerOptions {
  horizontalScrollEl: Ref<HTMLElement | null>;
  videoScrollEl: Ref<HTMLElement | null>;
  audioScrollEl: Ref<HTMLElement | null>;
  videoLabelsScrollEl?: Ref<HTMLElement | null>;
  audioLabelsScrollEl?: Ref<HTMLElement | null>;
  rulerContainerRef: Ref<HTMLElement | null>;
  scrollEl: Ref<HTMLElement | null>;
  tracks: Ref<TimelineTrack[]> | { value: TimelineTrack[] };
}

export function useTimelineWheelHandler({
  horizontalScrollEl,
  videoScrollEl,
  audioScrollEl,
  videoLabelsScrollEl,
  audioLabelsScrollEl,
  rulerContainerRef,
  scrollEl,
  tracks,
}: UseTimelineWheelHandlerOptions) {
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();

  const { handleZoomWheel, fitTimelineZoom } = useTimelineZoom({ scrollEl });

  const fps = computed(() => timelineStore.timelineFormat.fps || 30);
  const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
  const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);
  const trackHeadersMouseSettings = computed(() => workspaceStore.userSettings.mouse.trackHeaders);
  const { trackHeights } = storeToRefs(timelineStore);

  function getActiveScrollEl(e: WheelEvent): HTMLElement | null {
    const target = e.target as HTMLElement;
    if (target.closest('.audio-tracks-scroll')) return audioScrollEl.value;
    if (target.closest('.video-tracks-scroll')) return videoScrollEl.value;
    // For track labels, return the labels scrollable container for vertical scrolling
    const labelsContainer = target.closest('.timeline-labels-container');
    if (labelsContainer) return labelsContainer as HTMLElement;
    return scrollEl.value;
  }

  function shouldUseNativeTimelineScroll(
    e: WheelEvent,
    action: string,
    category: keyof FastCatUserSettings['mouse'],
  ) {
    if (category !== 'timeline') return false;
    if (action === 'scroll_vertical') return !isSecondaryWheel(e);
    return false;
  }

  function getZoomAnchorViewportX(params: {
    event: WheelEvent;
    category: keyof FastCatUserSettings['mouse'];
    activeEl: HTMLElement;
  }): number {
    if (params.category === 'ruler' && rulerContainerRef.value) {
      const rect = rulerContainerRef.value.getBoundingClientRect();
      return params.event.clientX - rect.left;
    }

    const target = params.event.target as HTMLElement | null;
    if (target?.closest('.timeline-labels-container')) {
      const scrollRect = horizontalScrollEl.value?.getBoundingClientRect();
      if (scrollRect) {
        return Math.max(0, params.event.clientX - scrollRect.left);
      }
      const viewportWidth = horizontalScrollEl.value?.clientWidth ?? 0;
      return viewportWidth / 2;
    }

    const rect = params.activeEl.getBoundingClientRect();
    return params.event.clientX - rect.left;
  }

  function getZoomStep(delta: number): number {
    const direction = delta > 0 ? -1 : 1;
    const magnitude = Math.abs(delta);

    if (magnitude < 4) return direction * 0.6;
    if (magnitude < 12) return direction * 1.2;
    if (magnitude < 40) return direction * 2;
    if (magnitude < 100) return direction * 3;

    return direction * 4;
  }

  function updateTrackHeight(trackId: string, height: number) {
    trackHeights.value[trackId] = height;
  }

  function onTimelineWheel(
    e: WheelEvent,
    category: keyof FastCatUserSettings['mouse'] = 'timeline',
  ) {
    const activeEl = getActiveScrollEl(e);
    if (!activeEl) return;

    const settings =
      category === 'ruler'
        ? rulerMouseSettings.value
        : category === 'trackHeaders'
          ? trackHeadersMouseSettings.value
          : timelineMouseSettings.value;

    const isShift = isLayer1Active(e, workspaceStore.userSettings);
    const secondary = isSecondaryWheel(e);
    const action = secondary
      ? isShift
        ? settings.wheelSecondaryShift
        : settings.wheelSecondary
      : isShift
        ? settings.wheelShift
        : settings.wheel;

    if (shouldUseNativeTimelineScroll(e, action, category)) return;

    if (action === 'none') {
      e.preventDefault();
      return;
    }

    const delta = getWheelDelta(e);

    if (action === 'scroll_vertical') {
      e.preventDefault();
      activeEl.scrollTop += delta;
      return;
    }

    if (action === 'scroll_horizontal') {
      e.preventDefault();
      horizontalScrollEl.value?.scrollBy({ left: delta });
      return;
    }

    if (action === 'zoom_horizontal') {
      e.preventDefault();
      const zoomStep = getZoomStep(delta);
      const prevZoom = timelineStore.timelineZoom;
      const rawAnchorViewportX = getZoomAnchorViewportX({
        event: e,
        category,
        activeEl,
      });

      const scrollLeft = horizontalScrollEl.value?.scrollLeft ?? 0;
      const viewportWidth = horizontalScrollEl.value?.clientWidth ?? 0;
      const durationTicks = timelineStore.duration;
      const timelineWidthPx = ticksToPx(durationTicks, timelineStore.timelineZoom);
      let nextZoom = Math.min(110, Math.max(0, prevZoom + zoomStep));

      if (zoomStep < 0 && durationTicks > 0 && viewportWidth > 0) {
        const minCursorZoom = Math.min(
          110,
          Math.max(0, pxPerSecondToZoom(viewportWidth / (durationTicks / TICKS_PER_SECOND))),
        );

        if (prevZoom <= minCursorZoom) return;

        nextZoom = Math.max(minCursorZoom, nextZoom);
      }

      let anchorViewportX = rawAnchorViewportX;
      let anchorTimeTicks = pxToTimeTicks(
        scrollLeft + rawAnchorViewportX,
        timelineStore.timelineZoom,
      );
      const nextTimelineWidthPx = ticksToPx(durationTicks, nextZoom);

      // Adaptive anchor: zoom out from viewport center when the timeline fits or will fit.
      if (
        zoomStep < 0 &&
        viewportWidth > 0 &&
        ((timelineWidthPx > 0 && timelineWidthPx <= viewportWidth) ||
          (nextTimelineWidthPx > 0 && nextTimelineWidthPx <= viewportWidth))
      ) {
        anchorViewportX = viewportWidth / 2;
        anchorTimeTicks = Math.max(0, Math.min(durationTicks, durationTicks / 2));
      } else {
        // Clamp anchor time to timeline bounds to avoid jumping past the end
        anchorTimeTicks = Math.max(0, Math.min(durationTicks, anchorTimeTicks));
      }

      const nextZoomStep = nextZoom - prevZoom;
      if (nextZoomStep !== 0) {
        handleZoomWheel(nextZoomStep, { anchorTimeTicks, anchorViewportX });
      }
      return;
    }

    if (action === 'zoom_horizontal_to_playhead') {
      e.preventDefault();
      const scrollLeft = horizontalScrollEl.value?.scrollLeft ?? 0;
      const playheadPx = ticksToPx(timelineStore.currentTime, timelineStore.timelineZoom);
      const anchorViewportX = playheadPx - scrollLeft;
      const anchorTimeTicks = Math.max(
        0,
        Math.min(timelineStore.duration, timelineStore.currentTime),
      );

      handleZoomWheel(getZoomStep(delta), { anchorTimeTicks, anchorViewportX });
      return;
    }

    if (action === 'zoom_vertical') {
      e.preventDefault();
      const factor = delta > 0 ? 0.9 : 1.1;
      tracks.value.forEach((track: TimelineTrack) => {
        const currentHeight = trackHeights.value[track.id] ?? 40;
        trackHeights.value[track.id] = Math.max(32, Math.min(300, currentHeight * factor));
      });
      return;
    }

    if (action === 'seek_frame') {
      e.preventDefault();
      const frameDurationTicks = TICKS_PER_SECOND / fps.value;
      timelineStore.setCurrentTimeTicks(
        Math.max(
          0,
          Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * frameDurationTicks),
        ),
      );
      return;
    }

    if (action === 'seek_second') {
      e.preventDefault();
      timelineStore.setCurrentTimeTicks(
        Math.max(
          0,
          Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * TICKS_PER_SECOND),
        ),
      );
      return;
    }

    if (action === 'resize_track') {
      e.preventDefault();
      const el =
        (e.target as Node).nodeType === 3
          ? (e.target as Node).parentElement
          : (e.target as Element);
      const trackId = el?.closest?.('[data-track-id]')?.getAttribute('data-track-id');
      if (trackId) {
        const currentHeight = trackHeights.value[trackId] ?? 40;
        const step = Math.abs(delta) < 10 ? delta * -1 : delta > 0 ? -8 : 8;
        updateTrackHeight(trackId, Math.max(32, Math.min(300, currentHeight + step)));
      }
    }
  }

  function setupWheelHandler(
    el: Ref<HTMLElement | null>,
    category: keyof FastCatUserSettings['mouse'] = 'timeline',
  ) {
    useEventListener(el, 'wheel', (e: WheelEvent) => onTimelineWheel(e, category), {
      passive: false,
    });
  }

  setupWheelHandler(videoScrollEl, 'timeline');
  setupWheelHandler(audioScrollEl, 'timeline');
  setupWheelHandler(rulerContainerRef, 'ruler');

  if (videoLabelsScrollEl) setupWheelHandler(videoLabelsScrollEl, 'trackHeaders');
  if (audioLabelsScrollEl) setupWheelHandler(audioLabelsScrollEl, 'trackHeaders');

  return { fitTimelineZoom };
}
