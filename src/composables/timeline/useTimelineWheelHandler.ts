import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useEventListener } from '@vueuse/core';
import type { FastCatUserSettings } from '~/utils/settings/defaults';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { getWheelDelta, isSecondaryWheel } from '~/utils/mouse';
import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import type { TimelineTrack } from '~/timeline/types';

export interface UseTimelineWheelHandlerOptions {
  videoScrollEl: Ref<HTMLElement | null>;
  audioScrollEl: Ref<HTMLElement | null>;
  videoLabelsScrollEl?: Ref<HTMLElement | null>;
  audioLabelsScrollEl?: Ref<HTMLElement | null>;
  rulerContainerRef: Ref<HTMLElement | null>;
  scrollEl: Ref<HTMLElement | null>;
  tracks: Ref<TimelineTrack[]> | { value: TimelineTrack[] };
}

export function useTimelineWheelHandler({
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
  const projectStore = useProjectStore();

  const { handleZoomWheel, fitTimelineZoom } = useTimelineZoom({ scrollEl });

  const fps = computed(() => projectStore.projectSettings.project.fps || 30);
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
    if (action === 'scroll_horizontal') return isSecondaryWheel(e);
    return false;
  }

  function updateTrackHeight(trackId: string, height: number) {
    trackHeights.value[trackId] = height;
    timelineStore.markTimelineAsDirty();
    timelineStore.requestTimelineSave();
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
      activeEl.scrollLeft += delta;
      return;
    }

    if (action === 'zoom_horizontal') {
      e.preventDefault();
      const rect = activeEl.getBoundingClientRect();
      const anchorViewportX = e.clientX - rect.left;
      const anchorTimeUs = pxToTimeUs(
        activeEl.scrollLeft + anchorViewportX,
        timelineStore.timelineZoom,
      );
      handleZoomWheel(delta > 0 ? -5 : 5, { anchorTimeUs, anchorViewportX });
      return;
    }

    if (action === 'zoom_vertical') {
      e.preventDefault();
      const factor = delta > 0 ? 0.9 : 1.1;
      tracks.value.forEach((track: TimelineTrack) => {
        const currentHeight = trackHeights.value[track.id] ?? 40;
        trackHeights.value[track.id] = Math.max(32, Math.min(300, currentHeight * factor));
      });
      timelineStore.markTimelineAsDirty();
      timelineStore.requestTimelineSave();
      return;
    }

    if (action === 'seek_frame') {
      e.preventDefault();
      const frameDurationUs = 1_000_000 / fps.value;
      timelineStore.setCurrentTimeUs(
        Math.max(0, Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * frameDurationUs)),
      );
      return;
    }

    if (action === 'seek_second') {
      e.preventDefault();
      timelineStore.setCurrentTimeUs(
        Math.max(0, Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * 1_000_000)),
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
