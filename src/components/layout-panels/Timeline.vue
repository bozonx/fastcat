<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useEventListener, useLocalStorage, useResizeObserver } from '@vueuse/core';
import type { FastCatUserSettings } from '~/utils/settings/defaults';

import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useUiStore } from '~/stores/ui.store';
import { usePresetsStore } from '~/stores/presets.store';

import type { TimelineClipActionPayload, TimelineTrack } from '~/timeline/types';
import { timeUsToPx, pxToTimeUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { getWheelDelta, isSecondaryWheel } from '~/utils/mouse';
import { useDraggedFile } from '~/composables/useDraggedFile';

import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';
import TimelinePlayheadOverlay from '~/components/timeline/TimelinePlayheadOverlay.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineScrollSync } from '~/composables/timeline/useTimelineScrollSync';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';

const TRACK_LABELS_WIDTH = 200;

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const timelineSettingsStore = useTimelineSettingsStore();
const projectStore = useProjectStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const presetsStore = usePresetsStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

const { currentProjectId, currentView } = storeToRefs(projectStore);

// Scroll elements
const videoScrollEl = ref<HTMLElement | null>(null);
const audioScrollEl = ref<HTMLElement | null>(null);
const rulerScrollEl = ref<HTMLElement | null>(null);
const videoLabelsScrollEl = ref<HTMLElement | null>(null);
const audioLabelsScrollEl = ref<HTMLElement | null>(null);
const rulerContainerRef = ref<HTMLElement | null>(null);

// Use videoScrollEl as scrollEl for composables (they need any scroll element with synced scrollLeft)
const scrollEl = videoScrollEl;

const scrollLeftRef = ref(0);
const scrollbarHeight = ref(0);
const viewportWidth = ref(0);
const trackAreaRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const { trackHeights } = storeToRefs(timelineStore);

const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const textPresetMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);

// Section resize state
const DEFAULT_VIDEO_SECTION_PERCENT = 60;
const MIN_SECTION_HEIGHT = 60;
const videoSectionPercent = useLocalStorage(
  `fastcat-timeline-video-section-${currentProjectId.value}`,
  DEFAULT_VIDEO_SECTION_PERCENT,
);
const sectionContainerRef = ref<HTMLElement | null>(null);

const isResizingSections = ref(false);
const resizeSectionStartY = ref(0);
const resizeSectionStartPercent = ref(0);

function onSectionResizeStart(e: MouseEvent) {
  e.preventDefault();
  isResizingSections.value = true;
  resizeSectionStartY.value = e.clientY;
  resizeSectionStartPercent.value = videoSectionPercent.value;
  window.addEventListener('mousemove', onSectionResizeMove);
  window.addEventListener('mouseup', onSectionResizeEnd);
}

function onSectionResizeMove(e: MouseEvent) {
  if (!isResizingSections.value || !sectionContainerRef.value) return;
  const containerHeight = sectionContainerRef.value.offsetHeight;
  if (containerHeight <= 0) return;
  const dy = e.clientY - resizeSectionStartY.value;
  const dpercent = (dy / containerHeight) * 100;
  const next = Math.max(10, Math.min(90, resizeSectionStartPercent.value + dpercent));
  videoSectionPercent.value = next;
}

function onSectionResizeEnd() {
  isResizingSections.value = false;
  window.removeEventListener('mousemove', onSectionResizeMove);
  window.removeEventListener('mouseup', onSectionResizeEnd);
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onSectionResizeMove);
  window.removeEventListener('mouseup', onSectionResizeEnd);
});

const timelineWidthPx = computed(() => {
  const maxUs = Math.max(timelineStore.duration, timelineStore.currentTime) + 30_000_000;
  return timeUsToPx(maxUs, timelineStore.timelineZoom);
});

const timelineWidthStyle = computed(() => ({
  width: `${timelineWidthPx.value}px`,
  minWidth: '100%',
}));

// --- Horizontal scroll sync ---
let isSyncingHorizontal = false;
function syncHorizontal(source: HTMLElement) {
  if (isSyncingHorizontal) return;
  isSyncingHorizontal = true;
  requestAnimationFrame(() => {
    const sl = source.scrollLeft;
    const targets = [videoScrollEl.value, audioScrollEl.value, rulerScrollEl.value];
    for (const el of targets) {
      if (el && el !== source && el.scrollLeft !== sl) {
        el.scrollLeft = sl;
      }
    }
    scrollLeftRef.value = sl;
    isSyncingHorizontal = false;
  });
}

function onVideoScroll(e: Event) {
  if (videoScrollEl.value) {
    syncHorizontal(videoScrollEl.value);
    if (videoLabelsScrollEl.value) {
      videoLabelsScrollEl.value.scrollTop = videoScrollEl.value.scrollTop;
    }
  }
}

function onAudioScroll(e: Event) {
  if (audioScrollEl.value) {
    syncHorizontal(audioScrollEl.value);
    if (audioLabelsScrollEl.value) {
      audioLabelsScrollEl.value.scrollTop = audioScrollEl.value.scrollTop;
    }
  }
}

function onRulerScroll(e: Event) {
  if (rulerScrollEl.value) {
    syncHorizontal(rulerScrollEl.value);
  }
}

function onVideoLabelsScroll() {
  if (videoLabelsScrollEl.value && videoScrollEl.value) {
    videoScrollEl.value.scrollTop = videoLabelsScrollEl.value.scrollTop;
  }
}

function onAudioLabelsScroll() {
  if (audioLabelsScrollEl.value && audioScrollEl.value) {
    audioScrollEl.value.scrollTop = audioLabelsScrollEl.value.scrollTop;
  }
}

// Video labels ref for scroll sync
const videoTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);
const audioTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);

// Context menu items
const timelineMenuItems = computed(() => [
  [
    {
      label: t('common.actions.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => {
        videoSectionPercent.value = DEFAULT_VIDEO_SECTION_PERCENT;
      },
    },
  ],
]);

const textPresetMenuItems = computed(() => {
  const standard = [
    {
      label: t('fastcat.library.texts.default', 'Default'),
      onSelect: () => applyTextPreset('default'),
    },
    {
      label: t('fastcat.library.texts.title', 'Title'),
      onSelect: () => applyTextPreset('title'),
    },
    {
      label: t('fastcat.library.texts.subtitle', 'Subtitle'),
      onSelect: () => applyTextPreset('subtitle'),
    },
  ];

  const custom = presetsStore.customPresets
    .filter((p) => p.category === 'text')
    .map((p) => ({
      label: p.name,
      onSelect: () => applyTextPreset(p.id),
    }));

  return [[...standard, ...custom]];
});

function applyTextPreset(presetId: string) {
  const trigger = uiStore.showTextPresetMenuTrigger;
  if (!trigger) return;

  const standardPresets: Record<string, any> = {
    default: {
      style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif' },
    },
    title: {
      style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif' },
    },
    subtitle: {
      style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif' },
    },
  };

  const preset =
    standardPresets[presetId] || presetsStore.customPresets.find((p) => p.id === presetId)?.params;

  if (preset) {
    timelineStore.updateClipProperties(trigger.trackId, trigger.itemId, {
      style: preset.style,
    });
  }
}

watch(
  () => uiStore.showTextPresetMenuTrigger,
  (val) => {
    if (val) {
      setTimeout(() => {
        textPresetMenuRef.value?.open({ clientX: val.x, clientY: val.y } as unknown as MouseEvent);
      }, 50);
    }
  },
);

function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains('timeline-section-resize-handle')) {
    e.preventDefault();
    menuRef.value?.open(e);
  }
}

const canEditClipContent = computed(() => ['cut', 'files', 'sound'].includes(currentView.value));
const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);
const videoTracks = computed(() => tracks.value.filter((t) => t.kind === 'video'));
const audioTracks = computed(() => tracks.value.filter((t) => t.kind === 'audio'));

const fps = computed(() => projectStore.projectSettings.project.fps || 30);

// Track scrollbar height from audio section (only one with visible horizontal scrollbar)
useResizeObserver(audioScrollEl, () => {
  if (audioScrollEl.value) {
    scrollbarHeight.value = audioScrollEl.value.offsetHeight - audioScrollEl.value.clientHeight;
    viewportWidth.value = audioScrollEl.value.clientWidth;
    timelineStore.timelineViewportWidth = viewportWidth.value;
  }
});

watch(
  () => timelineStore.scrollResetTicket,
  () => {
    for (const el of [videoScrollEl.value, audioScrollEl.value, rulerScrollEl.value]) {
      if (el) el.scrollLeft = 0;
    }
  },
);

// Panning logic (adapted from useTimelineScrollSync)
const isPanning = ref(false);
const hasPanned = ref(false);
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, el: null as HTMLElement | null });
const DRAG_DEADZONE_PX = 5;

function getActiveScrollEl(e: PointerEvent): HTMLElement | null {
  const target = e.target as HTMLElement;
  if (target.closest('.video-tracks-scroll')) return videoScrollEl.value;
  if (target.closest('.audio-tracks-scroll')) return audioScrollEl.value;
  return videoScrollEl.value;
}

function startPan(e: PointerEvent) {
  const el = getActiveScrollEl(e);
  if (!el) return;
  e.preventDefault();
  isPanning.value = true;
  hasPanned.value = false;
  panStart.value = {
    x: e.clientX,
    y: e.clientY,
    scrollLeft: el.scrollLeft,
    scrollTop: el.scrollTop,
    el,
  };
  el.setPointerCapture(e.pointerId);
}

function onPanMove(e: PointerEvent) {
  if (!isPanning.value || !panStart.value.el) return;
  e.preventDefault();
  const dx = e.clientX - panStart.value.x;
  const dy = e.clientY - panStart.value.y;
  if (!hasPanned.value && (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX)) {
    hasPanned.value = true;
  }
  // Horizontal pan syncs across all sections
  panStart.value.el.scrollLeft = panStart.value.scrollLeft - dx;
  panStart.value.el.scrollTop = panStart.value.scrollTop - dy;
}

function stopPan(e: PointerEvent) {
  if (!isPanning.value || !panStart.value.el) return;
  e.preventDefault();
  isPanning.value = false;
  panStart.value.el.releasePointerCapture(e.pointerId);
}

const { handleZoomWheel, fitTimelineZoom } = useTimelineZoom({ scrollEl });
const {
  dragPreview,
  clearDragPreview,
  handleFileDrop,
  handleLibraryDrop,
  getDropPosition,
  onTrackDragOver,
  onTrackDragLeave,
} = useTimelineDropHandling({ scrollEl });

const {
  draggingMode,
  draggingItemId,
  movePreview,
  slipPreview,
  onTimeRulerPointerDown: onBaseTimeRulerPointerDown,
  startPlayheadDrag,
  isDraggingPlayhead,
  hasPlayheadMoved,
  onGlobalPointerMove: onBaseGlobalPointerMove,
  onGlobalPointerUp: onBaseGlobalPointerUp,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);

function onTimelinePointerMove(e: PointerEvent) {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  const settings = isRuler ? rulerMouseSettings.value : timelineMouseSettings.value;

  if (
    settings.horizontalMovement === 'move_playhead' &&
    !draggingMode.value &&
    !isPanning.value &&
    !isDraggingPlayhead.value
  ) {
    const el = getActiveScrollEl(e) || scrollEl.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
    }
  }

  onBaseGlobalPointerMove(e);
  onPanMove(e);
}

function onTimelinePointerUp(e: PointerEvent) {
  onBaseGlobalPointerUp(e);
  stopPan(e);
}

function onTimeRulerPointerDown(e: PointerEvent) {
  focusStore.setMainFocus('timeline');
  onBaseTimeRulerPointerDown(e);
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

  // Determine which tracks are in this scroll element
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

// Wheel handling for both sections
function setupWheelHandler(el: Ref<HTMLElement | null>, category: keyof FastCatUserSettings['mouse'] = 'timeline') {
  useEventListener(el, 'wheel', (e: WheelEvent) => onTimelineWheel(e, category), { passive: false });
}

setupWheelHandler(videoScrollEl, 'timeline');
setupWheelHandler(audioScrollEl, 'timeline');
setupWheelHandler(rulerContainerRef, 'ruler');

function shouldUseNativeTimelineScroll(
  e: WheelEvent,
  action: string,
  category: keyof FastCatUserSettings['mouse'],
) {
  if (category !== 'timeline') return false;

  if (action === 'scroll_vertical') {
    return !isSecondaryWheel(e);
  }

  if (action === 'scroll_horizontal') {
    return isSecondaryWheel(e);
  }

  return false;
}

function onTimelineWheel(e: WheelEvent, category: keyof FastCatUserSettings['mouse'] = 'timeline') {
  // Find which scroll element is being used
  const target = e.target as HTMLElement;
  const activeEl = target.closest('.audio-tracks-scroll')
    ? audioScrollEl.value
    : target.closest('.video-tracks-scroll')
      ? videoScrollEl.value
      : scrollEl.value;

  if (!activeEl) return;

  let settings;
  if (category === 'timeline') {
    settings = timelineMouseSettings.value;
  } else if (category === 'ruler') {
    settings = rulerMouseSettings.value;
  } else {
    settings = timelineMouseSettings.value;
  }

  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const secondary = isSecondaryWheel(e);
  const action = secondary
    ? isShift
      ? settings.wheelSecondaryShift
      : settings.wheelSecondary
    : isShift
      ? settings.wheelShift
      : settings.wheel;

  if (shouldUseNativeTimelineScroll(e, action, category)) {
    return;
  }

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
    const el = (e.target as Node).nodeType === 3 ? (e.target as Node).parentElement : (e.target as Element);
    const trackEl = el?.closest?.('[data-track-id]');
    const trackId = trackEl?.getAttribute('data-track-id');
    if (trackId) {
      const currentHeight = trackHeights.value[trackId] ?? 40;
      const step = Math.abs(delta) < 10 ? delta * -1 : delta > 0 ? -8 : 8;
      const nextHeight = Math.max(32, Math.min(300, currentHeight + step));
      updateTrackHeight(trackId, nextHeight);
    }
  }
}

async function onClipAction(payload: TimelineClipActionPayload) {
  try {
    if (payload.action === 'extractAudio') {
      await timelineStore.extractAudioToTrack({
        videoTrackId: payload.trackId,
        videoItemId: payload.itemId,
      });
    } else if (payload.action === 'freezeFrame') {
      timelineStore.setClipFreezeFrameFromPlayhead({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else if (payload.action === 'resetFreezeFrame') {
      timelineStore.resetClipFreezeFrame({ trackId: payload.trackId, itemId: payload.itemId });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: unknown) {
    toast.add({
      title: t('common.error'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  }
}

function updateTrackHeight(trackId: string, height: number) {
  trackHeights.value[trackId] = height;
  timelineStore.markTimelineAsDirty();
  timelineStore.requestTimelineSave();
}

const onDrop = async (e: DragEvent, trackId: string) => {
  const startUs = getDropPosition(e);
  if (startUs === null) return;

  const pseudo =
    isLayer1Active(e as unknown as MouseEvent, workspaceStore.userSettings) ||
    timelineSettingsStore.overlapMode === 'pseudo';

  const libraryItemData =
    e.dataTransfer?.getData('fastcat-item') || e.dataTransfer?.getData('application/json');
  if (libraryItemData) {
    try {
      const parsed = JSON.parse(libraryItemData);
      if (parsed.kind || (Array.isArray(parsed) && parsed.length > 0 && parsed[0].kind)) {
        await handleLibraryDrop(libraryItemData, trackId, startUs, {
          pseudo,
          clientX: e.clientX,
          clientY: e.clientY,
        });
        return;
      }
    } catch {
      // ignore
    }
  }

  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) {
    await handleFileDrop(files, trackId, startUs);
  }

  clearDragPreview();
};

function onDragVirtualStart(event: DragEvent, type: 'adjustment' | 'background' | 'text') {
  setDraggedFile({
    kind: type,
    name: t(
      `fastcat.timeline.${type}ClipDefaultName`,
      type.charAt(0).toUpperCase() + type.slice(1),
    ),
    path: '',
  });
}

function onDragVirtualEnd() {
  clearDraggedFile();
}

function setPlayheadTime(timeUs: number) {
  timelineStore.setCurrentTimeUs(timeUs);
}

const handleTimelineClickAction = (action: string, e: PointerEvent | MouseEvent) => {
  if (action === 'none') return;
  if (action === 'reset_zoom') {
    timelineStore.resetTimelineZoom();
    return;
  }
  if (action === 'fit_zoom') {
    timelineStore.fitTimelineZoom();
    return;
  }
  if (action === 'select_item') {
    return;
  }
  if (action === 'select_multiple') {
    return;
  }
  if (action === 'seek' || action === 'move_playhead') {
    const el = getActiveScrollEl(e as PointerEvent) || scrollEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
    return;
  }
  if (action === 'select_area') {
    return;
  }
  if (action === 'add_marker') {
    const el = getActiveScrollEl(e as PointerEvent) || scrollEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const timeUs = pxToTimeUs(x, timelineStore.timelineZoom);
    const newMarkerId = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    timelineStore.applyTimeline({
      type: 'add_marker',
      id: newMarkerId,
      timeUs,
      text: '',
    });
  }
};

const onTrackAreaPointerDownCapture = (e: PointerEvent) => {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  if (isRuler) return;

  if (e.button === 1) {
    hasPanned.value = false;
    hasPlayheadMoved.value = false;
    const settings = timelineMouseSettings.value;

    if (settings.middleDrag === 'pan') {
      startPan(e);
    } else if (settings.middleDrag === 'move_playhead') {
      const el = getActiveScrollEl(e) || scrollEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
      startPlayheadDrag(e);
    }
  }
};

const onTrackAreaAuxClick = (e: MouseEvent) => {
  if (e.button === 1) {
    const isRuler = (e.target as HTMLElement).closest('.timeline-ruler-container');
    if (!isRuler) {
      if (hasPanned.value || hasPlayheadMoved.value) return;
      const settings = timelineMouseSettings.value;
      handleTimelineClickAction(settings.middleClick, e);
    }
  }
};

function executeTimelineRulerAction(action: string, e: MouseEvent) {
  if (action === 'none') return;

  const el = rulerScrollEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left + el.scrollLeft;
  const timeUs = pxToTimeUs(x, timelineStore.timelineZoom);

  if (action === 'seek') {
    timelineStore.setCurrentTimeUs(timeUs);
  } else if (action === 'add_marker') {
    const id = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    timelineStore.applyTimeline({
      type: 'add_marker',
      id,
      timeUs,
      text: '',
    });
  } else if (action === 'reset_zoom') {
    timelineStore.resetTimelineZoom();
  }
}
</script>

<template>
  <div
    ref="containerRef"
    class="panel-focus-frame relative flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('timeline'),
    }"
    @pointerdown.capture="focusStore.setMainFocus('timeline')"
    @contextmenu="onContextMenu"
  >
    <UiContextMenuPortal
      ref="menuRef"
      :items="timelineMenuItems"
      :target-el="containerRef"
      manual
    />
    <UiContextMenuPortal
      ref="textPresetMenuRef"
      :items="textPresetMenuItems"
      :target-el="containerRef"
      manual
    />

    <!-- Row 1: Timeline Toolbar -->
    <TimelineToolbar
      @drag-virtual-start="onDragVirtualStart"
      @drag-virtual-end="onDragVirtualEnd"
    />

    <!-- Row 2: Ruler with playhead timecode -->
    <div
      class="flex shrink-0 h-8 border-b border-ui-border"
      @pointermove="onTimelinePointerMove"
      @pointerup="onTimelinePointerUp"
      @pointercancel="onTimelinePointerUp"
    >
      <!-- Playhead timecode -->
      <div
        class="shrink-0 border-r border-ui-border bg-ui-bg-elevated flex items-center justify-center px-2"
        :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
      >
        <UiTimecode
          :model-value="timelineStore.currentTime"
          @update:model-value="setPlayheadTime"
        />
      </div>
      <!-- Ruler -->
      <div
        ref="rulerContainerRef"
        class="flex-1 relative z-10 timeline-ruler-container overflow-hidden"
      >
        <!-- Ruler is outside the scroll element for correct coordinate mapping (same as TimelineGrid) -->
        <TimelineRuler
          class="absolute inset-0 h-full border-b border-ui-border bg-ui-bg-elevated cursor-pointer"
          :scroll-el="rulerScrollEl"
          @pointerdown="onTimeRulerPointerDown"
          @start-playhead-drag="startPlayheadDrag"
          @start-pan="startPan"
        />
        <!-- Invisible scroll element for horizontal scroll position sync only -->
        <div
          ref="rulerScrollEl"
          class="absolute inset-0 overflow-x-scroll overflow-y-hidden scroll-sync-hidden pointer-events-none"
          @scroll="onRulerScroll"
        >
          <div :style="{ ...timelineWidthStyle, paddingRight: `${scrollbarHeight}px` }" class="h-full" />
        </div>
      </div>
    </div>

    <!-- Rows 3 & 4: Track sections -->
    <div
      ref="sectionContainerRef"
      class="flex-1 flex flex-col min-h-0 relative"
      @pointermove="onTimelinePointerMove"
      @pointerup="onTimelinePointerUp"
      @pointercancel="onTimelinePointerUp"
      @pointerdown.capture="onTrackAreaPointerDownCapture"
      @auxclick="onTrackAreaAuxClick"
    >
      <!-- Video Tracks Section -->
      <div
        class="flex shrink-0 min-h-[60px] relative border-b border-ui-border"
        :style="{ height: `${videoSectionPercent}%` }"
      >
        <!-- Video Track Labels -->
        <div
          ref="videoLabelsScrollEl"
          class="shrink-0 border-r border-ui-border overflow-y-auto overflow-x-hidden scroll-sync-hidden"
          :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
          @scroll="onVideoLabelsScroll"
        >
          <TimelineTrackLabels
            ref="videoTrackLabelsRef"
            :tracks="videoTracks"
            :track-heights="trackHeights"
            :on-zoom-to-fit="fitTimelineZoom"
            @update:track-height="updateTrackHeight"
          />
        </div>
        <!-- Video Tracks Area -->
        <div class="flex-1 relative min-h-0 min-w-0">
          <!-- Grid behind tracks -->
          <TimelineGrid
            class="absolute inset-0 pointer-events-none z-0"
            :scroll-el="videoScrollEl"
          />
          <div
            ref="videoScrollEl"
            class="w-full h-full overflow-y-auto overflow-x-scroll scroll-sync-hidden relative z-10 video-tracks-scroll"
            @click="onTimelineClick"
            @scroll="onVideoScroll"
          >
            <TimelineTracks
              :tracks="videoTracks"
              :track-heights="trackHeights"
              :can-edit-clip-content="canEditClipContent"
              :drag-preview="dragPreview"
              :move-preview="movePreview"
              :slip-preview="slipPreview"
              :dragging-mode="draggingMode"
              :dragging-item-id="draggingItemId"
              :scroll-left="scrollLeftRef"
              :viewport-width="viewportWidth"
              :on-zoom-to-fit="fitTimelineZoom"
              @drop="onDrop"
              @dragover="onTrackDragOver"
              @dragleave="onTrackDragLeave"
              @start-move-item="startMoveItem"
              @select-item="selectItem"
              @start-trim-item="startTrimItem"
              @clip-action="onClipAction"
            />
          </div>
          <!-- Playhead/marker overlay: outside scroll container so it spans full viewport height -->
          <TimelinePlayheadOverlay
            class="absolute inset-0 pointer-events-none z-20"
            :scroll-el="videoScrollEl"
          />
        </div>
      </div>

      <!-- Section resize handle -->
      <div
        class="timeline-section-resize-handle h-1.5 cursor-ns-resize bg-ui-bg hover:bg-primary-500/30 transition-colors z-20 shrink-0 flex items-center justify-center group"
        @mousedown="onSectionResizeStart"
      >
        <div class="w-8 h-0.5 rounded bg-ui-border group-hover:bg-primary-500/60 transition-colors" />
      </div>

      <!-- Audio Tracks Section -->
      <div class="flex flex-1 min-h-[60px] relative">
        <!-- Audio Track Labels -->
        <div
          ref="audioLabelsScrollEl"
          class="shrink-0 border-r border-ui-border overflow-y-auto overflow-x-hidden scroll-sync-hidden"
          :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
          @scroll="onAudioLabelsScroll"
        >
          <TimelineTrackLabels
            ref="audioTrackLabelsRef"
            :tracks="audioTracks"
            :track-heights="trackHeights"
            :on-zoom-to-fit="fitTimelineZoom"
            @update:track-height="updateTrackHeight"
          />
        </div>
        <!-- Audio Tracks Area -->
        <div class="flex-1 relative min-h-0 min-w-0">
          <!-- Grid behind tracks -->
          <TimelineGrid
            class="absolute inset-0 pointer-events-none z-0"
            :scroll-el="audioScrollEl"
          />
          <div
            ref="audioScrollEl"
            class="w-full h-full overflow-auto relative z-10 audio-tracks-scroll timeline-scroll-el"
            @click="onTimelineClick"
            @scroll="onAudioScroll"
          >
            <TimelineTracks
              :tracks="audioTracks"
              :track-heights="trackHeights"
              :can-edit-clip-content="canEditClipContent"
              :drag-preview="dragPreview"
              :move-preview="movePreview"
              :slip-preview="slipPreview"
              :dragging-mode="draggingMode"
              :dragging-item-id="draggingItemId"
              :scroll-left="scrollLeftRef"
              :viewport-width="viewportWidth"
              :on-zoom-to-fit="fitTimelineZoom"
              @drop="onDrop"
              @dragover="onTrackDragOver"
              @dragleave="onTrackDragLeave"
              @start-move-item="startMoveItem"
              @select-item="selectItem"
              @start-trim-item="startTrimItem"
              @clip-action="onClipAction"
            />
          </div>
          <!-- Playhead/marker overlay: outside scroll container so it spans full viewport height -->
          <TimelinePlayheadOverlay
            class="absolute inset-0 pointer-events-none z-20"
            :scroll-el="audioScrollEl"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Hide scrollbar while keeping scroll functionality for synced scroll elements */
.scroll-sync-hidden {
  scrollbar-width: none;
}
.scroll-sync-hidden::-webkit-scrollbar {
  display: none;
}

/* Audio section has the visible horizontal scrollbar */
.timeline-scroll-el {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}

.timeline-scroll-el::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}

.timeline-scroll-el::-webkit-scrollbar-track {
  background: transparent;
}

.timeline-scroll-el::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.timeline-scroll-el::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
</style>
