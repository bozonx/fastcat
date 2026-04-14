import { computed, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import type { TimelineTrack } from '~/timeline/types';
import { resolvePlayheadClickTimeUs } from './timelineInteractionUtils';

export interface UseTimelineClickActionsOptions {
  horizontalScrollEl: Ref<HTMLElement | null>;
  videoScrollEl: Ref<HTMLElement | null>;
  audioScrollEl: Ref<HTMLElement | null>;
  scrollEl: Ref<HTMLElement | null>;
  videoTracks: Ref<TimelineTrack[]>;
  audioTracks: Ref<TimelineTrack[]>;
  getActiveScrollEl: (e: PointerEvent | MouseEvent) => HTMLElement | null;
}

export function useTimelineClickActions({
  horizontalScrollEl,
  videoScrollEl,
  audioScrollEl: _audioScrollEl,
  scrollEl,
  videoTracks,
  audioTracks,
  getActiveScrollEl,
}: UseTimelineClickActionsOptions) {
  const timelineStore = useTimelineStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();

  const { trackHeights } = storeToRefs(timelineStore);
  const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
  const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);

  function getSnappedPlayheadTimeUs(rawTimeUs: number) {
    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;

    return resolvePlayheadClickTimeUs({
      rawTimeUs,
      zoom: timelineStore.timelineZoom,
      snapThresholdPx: workspaceStore.userSettings.timeline.snapThresholdPx,
      toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
      snapping: workspaceStore.userSettings.timeline.snapping,
      tracks: [...videoTracks.value, ...audioTracks.value],
      markers: timelineStore.markers,
      durationUs: timelineEndUs,
      selectionRangeUs: timelineStore.selectionRange,
    });
  }

  function handleTimelineClickAction(action: string, e: PointerEvent | MouseEvent) {
    if (action === 'none') return;

    if (action === 'reset_zoom') {
      timelineStore.resetTimelineZoom();
      return;
    }
    if (action === 'fit_zoom') {
      timelineStore.fitTimelineZoom();
      return;
    }
    if (action === 'select_item' || action === 'select_multiple' || action === 'select_area') {
      return;
    }
    if (action === 'seek' || action === 'move_playhead') {
      const el = getActiveScrollEl(e as PointerEvent) || scrollEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + (horizontalScrollEl.value?.scrollLeft ?? 0);
      const rawTimeUs = pxToTimeUs(x, timelineStore.timelineZoom);
      timelineStore.setCurrentTimeUs(getSnappedPlayheadTimeUs(rawTimeUs));
      return;
    }
    if (action === 'add_marker') {
      const el = getActiveScrollEl(e as PointerEvent) || scrollEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + (horizontalScrollEl.value?.scrollLeft ?? 0);
      const timeUs = pxToTimeUs(x, timelineStore.timelineZoom);
      timelineStore.applyTimeline({
        type: 'add_marker',
        id: `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        timeUs,
        text: '',
      });
    }
  }

  function onTimelineClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    if (timelineStore.isTrimModeActive) {
      if (!target?.closest('[data-clip-id]')) {
        timelineStore.isTrimModeActive = false;
      }
      return;
    }

    if (
      target?.closest('button, .cursor-ew-resize, .cursor-ns-resize, [data-clip-id], [data-gap-id]')
    )
      return;

    const el = getActiveScrollEl(e as unknown as PointerEvent) || scrollEl.value;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop;
    const isVideoSection = el === videoScrollEl.value;
    const sectionTracks = isVideoSection ? videoTracks.value : audioTracks.value;
    const totalTracksHeight = sectionTracks.reduce(
      (sum, tr) => sum + (trackHeights.value[tr.id] ?? 40),
      0,
    );

    if (y > totalTracksHeight) {
      timelineStore.selectTimelineProperties();
      return;
    }

    const isShift = isLayer1Active(e, workspaceStore.userSettings);
    const action = isShift
      ? timelineMouseSettings.value.shiftClick
      : timelineMouseSettings.value.click;
    handleTimelineClickAction(action, e);
  }

  function executeTimelineRulerAction(action: string, e: MouseEvent) {
    if (action === 'none') return;
    const el = horizontalScrollEl.value;
    if (!el) return;
    const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left + el.scrollLeft;
    const rawTimeUs = pxToTimeUs(x, timelineStore.timelineZoom);
    const timeUs = getSnappedPlayheadTimeUs(rawTimeUs);

    if (action === 'seek') {
      timelineStore.setCurrentTimeUs(timeUs);
    } else if (action === 'add_marker') {
      timelineStore.applyTimeline({
        type: 'add_marker',
        id: `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        timeUs,
        text: '',
      });
    } else if (action === 'reset_zoom') {
      timelineStore.resetTimelineZoom();
    }
  }

  function onGlobalTimelineClick(e: MouseEvent) {
    if (!timelineStore.isTrimModeActive) return;
    const target = e.target as HTMLElement;
    if (target?.closest('[data-timeline-toolbar]')) return;
    if (
      !target?.closest('.video-tracks-scroll') &&
      !target?.closest('.audio-tracks-scroll') &&
      !target?.closest('[data-clip-id]')
    ) {
      timelineStore.isTrimModeActive = false;
    }
  }

  useEventListener(window, 'click', onGlobalTimelineClick, { capture: true });

  return {
    onTimelineClick,
    handleTimelineClickAction,
    executeTimelineRulerAction,
    timelineMouseSettings,
    rulerMouseSettings,
  };
}
