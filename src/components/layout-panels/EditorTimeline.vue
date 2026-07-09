<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';

import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useUiStore } from '~/stores/ui.store';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { useMediaStore } from '~/stores/media.store';
import { checkFileTimelineCompatibility } from '~/utils/media/compatibility';

import type {
  TextClipStyle,
  ClipTransition,
  TimelineMarker,
  TimelineClipActionPayload,
  TimelineOpenSpeedModalPayload,
  TimelineTrack,
} from '~/timeline/types';
import { createMarkerId } from '~/timeline/id';
import {
  computeTimelineCenteredScrollLeftForPlayhead,
  computeTimelineScrollLeftForPlayhead,
  computeTimelinePlaybackAutoScrollLeft,
  timeUsToPx,
  pxToTimeUs,
} from '~/utils/timeline/geometry';
import { isLayer1Pressed } from '~/utils/hotkeys/layerUtils';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext } from '~/composables/dnd/dndTypes';
import { TIMELINE_TRACK_LABELS_WIDTH as TRACK_LABELS_WIDTH } from '~/utils/constants';

import TimelineTrackSection from '~/components/timeline/TimelineTrackSection.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';
import TimelineSpeedModal from '~/components/timeline/TimelineSpeedModal.vue';

import { useTimelineSectionResize } from '~/composables/timeline/useTimelineSectionResize';
import { useTimelineHorizontalScrollSync } from '~/composables/timeline/useTimelineHorizontalScrollSync';
import { useTimelinePan } from '~/composables/timeline/useTimelinePan';
import { useTimelineWheelHandler } from '~/composables/timeline/useTimelineWheelHandler';
import { useTimelineClickActions } from '~/composables/timeline/useTimelineClickActions';
import { useTimelineTextPreset } from '~/composables/timeline/useTimelineTextPreset';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';
import { useTimelineClipActions } from '~/composables/timeline/useTimelineClipActions';
import { useTimelineSpeedModal } from '~/composables/timeline/useTimelineSpeedModal';
import TextPresetSelectionModal from '~/components/timeline/TextPresetSelectionModal.vue';

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const focusStore = useFocusStore();
const timelineSettingsStore = useTimelineSettingsStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const mediaStore = useMediaStore();
const runtimeConfig = useRuntimeConfig();
const { draggedFile } = useDraggedFile();

const {
  speedModal,
  openSpeedModal,
  saveSpeedModal,
  speedModalTargetHasAudio,
  speedModalTargetIsAudioTrack,
} = useTimelineSpeedModal(() => tracks.value);

interface TauriInternalFileDropDetail {
  clientX: number;
  clientY: number;
  payload?: unknown;
}

interface FileManagerTimelineDndData {
  items?: Array<{ name: string; path?: string; kind?: string; isExternal?: boolean }>;
  primaryEntry?: { source?: string; path?: string };
}

const { currentProjectId, currentView } = storeToRefs(projectStore);
const { trackHeights } = storeToRefs(timelineStore);

// --- Template refs ---
const containerRef = ref<HTMLElement | null>(null);
const masterScrollEl = ref<HTMLElement | null>(null);
const rulerContainerRef = ref<HTMLElement | null>(null);
const videoSectionRef = ref<InstanceType<typeof TimelineTrackSection> | null>(null);
const audioSectionRef = ref<InstanceType<typeof TimelineTrackSection> | null>(null);
const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);

// --- Derived scroll elements (from TimelineTrackSection via defineExpose) ---
// Vue unwraps refs exposed via defineExpose, so .scrollEl is HTMLElement | null directly
const videoScrollEl = computed(() => videoSectionRef.value?.scrollEl ?? null);
const audioScrollEl = computed(() => audioSectionRef.value?.scrollEl ?? null);
const videoLabelsScrollEl = computed(() => videoSectionRef.value?.labelsScrollEl ?? null);
const audioLabelsScrollEl = computed(() => audioSectionRef.value?.labelsScrollEl ?? null);
const scrollEl = masterScrollEl;

// --- Data ---
const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);
const videoTracks = computed(() => tracks.value.filter((t) => t.kind === 'video'));
const audioTracks = computed(() => tracks.value.filter((t) => t.kind === 'audio'));
const canEditClipContent = computed(() => ['cut', 'files', 'sound'].includes(currentView.value));
const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);

const anyMuted = computed(() => tracks.value.some((t) => t.audioMuted));
const anyLocked = computed(() => tracks.value.some((t) => t.locked));
const anyHidden = computed(() => tracks.value.some((t) => t.videoHidden));
const { isAnyTrackSoloed } = storeToRefs(timelineStore);
const trackResetButtons = computed(() =>
  [
    {
      active: anyLocked.value,
      icon: 'i-heroicons-lock-closed',
      tooltip: t('fastcat.track.resetLocked'),
      shortcuts: ['L'],
      color: '#3b82f6',
      textColor: '#ffffff',
      class: '',
      onClick: () => timelineStore.unlockAllTracks(),
    },
    {
      active: anyHidden.value,
      icon: 'i-heroicons-eye-slash',
      tooltip: t('fastcat.track.resetHidden'),
      shortcuts: ['H'],
      color: '#ffffff',
      textColor: '#000000',
      class: 'ring-1 ring-ui-border',
      onClick: () => timelineStore.showAllTracks(),
    },
    {
      active: anyMuted.value,
      icon: 'i-heroicons-speaker-x-mark',
      tooltip: t('fastcat.track.resetMuted'),
      shortcuts: ['M'],
      color: '#ef4444',
      textColor: '#ffffff',
      class: '',
      onClick: () => timelineStore.unmuteAllTracks(),
    },
    {
      active: isAnyTrackSoloed.value,
      icon: 'i-heroicons-musical-note',
      tooltip: t('fastcat.track.resetSolo'),
      shortcuts: ['S'],
      color: '#22c55e',
      textColor: '#ffffff',
      class: '',
      onClick: () => timelineStore.unsoloAllTracks(),
    },
  ].filter((button) => button.active),
);

const timelineWidthStyle = computed(() => {
  const maxUs = timelineStore.duration + 30_000_000;
  const widthPx = timeUsToPx(maxUs, timelineStore.timelineZoom);
  return { width: `${widthPx}px`, minWidth: '100%' };
});

// --- Composables ---
const { videoSectionPercent, sectionContainerRef, onSectionResizeStart, resetSectionPercent } =
  useTimelineSectionResize({
    projectId: currentProjectId,
    storage: {
      get: (key) => projectStore.projectSettings.ui.layout.splitSizes[key]?.[0] ?? null,
      set: (key, value) => {
        projectStore.projectSettings.ui.layout.splitSizes[key] = [value];
      },
    },
  });

const {
  scrollLeftRef,
  scrollbarHeight,
  viewportWidth,
  onMasterScroll,
  onVideoScroll,
  onAudioScroll,
  onVideoLabelsScroll,
  onAudioLabelsScroll,
} = useTimelineHorizontalScrollSync({
  master: masterScrollEl,
  video: videoScrollEl,
  audio: audioScrollEl,
  videoLabels: videoLabelsScrollEl,
  audioLabels: audioLabelsScrollEl,
});

const { isPanning, hasPanned, getActiveScrollEl, startPan, onPanMove, stopPan } = useTimelinePan({
  horizontalScrollEl: masterScrollEl,
  videoScrollEl,
  audioScrollEl,
});

const { fitTimelineZoom } = useTimelineWheelHandler({
  horizontalScrollEl: masterScrollEl,
  videoScrollEl,
  audioScrollEl,
  videoLabelsScrollEl,
  audioLabelsScrollEl,
  rulerContainerRef,
  scrollEl,
  tracks,
});

const { onTimelineClick, handleTimelineClickAction } = useTimelineClickActions({
  horizontalScrollEl: masterScrollEl,
  videoScrollEl,
  audioScrollEl,
  scrollEl,
  videoTracks,
  audioTracks,
  getActiveScrollEl,
});

const {
  textPresetMenuRef,
  textPresetMenuItems,
  isPresetModalOpen,
  pendingClipInfo,
  applyTextPreset,
  cancelTextPreset,
} = useTimelineTextPreset();

const {
  dragPreview,
  clearDragPreview,
  buildPointerDragPreview,
  handleFileDrop,
  handleLibraryDrop,
  getDropPosition,
  onTrackDragOver,
  onTrackDragLeave,
  isImporting,
  importProgress,
  importFileName,
  importPhase,
  cancelImport,
} = useTimelineDropHandling({ scrollEl });

const {
  draggingMode,
  draggingItemId,
  movePreview,
  slipPreview,
  trimPreview,
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

const { applyClipAction } = useTimelineClipActions();

// --- Context menu ---
const { emptyAreaContextMenuItems } = useTimelineEmptyAreaContextMenu({
  onZoomToFit: () => fitTimelineZoom(),
});

const timelineMenuItems = computed(() => [
  ...emptyAreaContextMenuItems.value,
  [
    {
      label: t('common.actions.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: resetSectionPercent,
    },
  ],
]);

// --- Event handlers ---
function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains('timeline-section-resize-handle')) {
    e.preventDefault();
    menuRef.value?.open(e);
  }
}

function onTimeRulerPointerDown(e: PointerEvent) {
  focusStore.setMainFocus('timeline');
  onBaseTimeRulerPointerDown(e);
}

let cachedPointerRectEl: HTMLElement | null = null;
let cachedPointerRect: DOMRect | null = null;
let pointerRectFrameId = 0;

function clearPointerRectCache() {
  cachedPointerRectEl = null;
  cachedPointerRect = null;
  if (pointerRectFrameId !== 0) {
    cancelAnimationFrame(pointerRectFrameId);
    pointerRectFrameId = 0;
  }
}

function getCachedPointerRect(el: HTMLElement): DOMRect {
  if (cachedPointerRectEl === el && cachedPointerRect) {
    return cachedPointerRect;
  }

  cachedPointerRectEl = el;
  cachedPointerRect = el.getBoundingClientRect();

  if (pointerRectFrameId === 0) {
    pointerRectFrameId = requestAnimationFrame(() => {
      pointerRectFrameId = 0;
      cachedPointerRectEl = null;
      cachedPointerRect = null;
    });
  }

  return cachedPointerRect;
}

function getTimeUsFromPointerEvent(el: HTMLElement, event: PointerEvent): number {
  const rect = getCachedPointerRect(el);
  const x = event.clientX - rect.left + (masterScrollEl.value?.scrollLeft ?? 0);
  return pxToTimeUs(x, timelineStore.timelineZoom);
}

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
      timelineStore.setCurrentTimeUs(getTimeUsFromPointerEvent(el, e));
    }
  }

  onBaseGlobalPointerMove(e);
  onPanMove(e);
}

function onTimelinePointerUp(e: PointerEvent) {
  clearPointerRectCache();
  onBaseGlobalPointerUp(e);
  stopPan(e);
}

function onTrackAreaPointerDownCapture(e: PointerEvent) {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  if (isRuler) return;

  const isLabels = (e.target as HTMLElement | null)?.closest('.timeline-labels-container');

  if (e.button === 1) {
    hasPanned.value = false;
    hasPlayheadMoved.value = false;

    if (isLabels) {
      // Middle click/drag on track labels — use trackHeaders settings, no pan/seek
      return;
    }

    if (timelineMouseSettings.value.middleDrag === 'pan') {
      startPan(e);
    } else if (timelineMouseSettings.value.middleDrag === 'move_playhead') {
      const el = getActiveScrollEl(e) || scrollEl.value;
      if (!el) return;
      timelineStore.setCurrentTimeUs(getTimeUsFromPointerEvent(el, e));
      startPlayheadDrag(e);
    }
  }
}

// Safety net for the drop ghost. The `dragPreview` is set on `dragover` over a
// track, but is only cleared by the track's own drop/leave handlers. When a drag
// ends without a real drop on a track — released over a gap, the ruler, the
// resize handle, empty area, or (for OS-file drags from the file manager) a
// final dragover that didn't preventDefault — none of those handlers run and the
// gray phantom clip lingers. External (OS) drags additionally never fire an
// in-page `dragend`, so we listen for every terminal drag signal at window level
// and always clear the preview. This is purely visual cleanup; real insertion is
// handled independently by `onDrop`, so clearing here can never drop a clip.
function onWindowDragTerminated() {
  clearDragPreview();
}

function onWindowDragLeave(e: DragEvent) {
  // Only react when the pointer actually leaves the document (relatedTarget is
  // null and there's no element under the cursor), i.e. the drag left the
  // window. Intra-document dragleave is handled per-track.
  if (e.relatedTarget !== null) return;
  clearDragPreview();
}

onBeforeUnmount(() => {
  clearPointerRectCache();
  window.removeEventListener('fastcat:tauri-internal-file-drop', onTauriInternalFileDrop);
  window.removeEventListener('drop', onWindowDragTerminated, true);
  window.removeEventListener('dragend', onWindowDragTerminated, true);
  window.removeEventListener('dragleave', onWindowDragLeave, true);
  if (runtimeConfig.public.e2eTest) {
    const e2eWindow = window as Window & FastcatE2eTimelineWindow;
    delete e2eWindow.__fastcatE2eSplitClipAtPlayhead;
    delete e2eWindow.__fastcatE2eSelectTimelineItems;
    delete e2eWindow.__fastcatE2eDeleteSelectedItems;
    delete e2eWindow.__fastcatE2eUpdateClipProperties;
    delete e2eWindow.__fastcatE2eSetCurrentTimeUs;
    delete e2eWindow.__fastcatE2eGetSelectedItemIds;
    delete e2eWindow.__fastcatE2eSaveTimeline;
    delete e2eWindow.__fastcatE2eSetTimelineZoom;
    delete e2eWindow.__fastcatE2eTrimClip;
    delete e2eWindow.__fastcatE2eMoveClip;
    delete e2eWindow.__fastcatE2eUpdateClipTransition;
    delete e2eWindow.__fastcatE2eAddTextClip;
    delete e2eWindow.__fastcatE2eAddProjectFileToTrack;
    delete e2eWindow.__fastcatE2eGetTimelineDocInfo;
    delete e2eWindow.__fastcatE2eAddMarker;
    delete e2eWindow.__fastcatE2eAddMarkers;
    delete e2eWindow.__fastcatE2eUpdateMarker;
    delete e2eWindow.__fastcatE2eRemoveMarker;
    delete e2eWindow.__fastcatE2eGetMarkers;
  }
});

onMounted(() => {
  window.addEventListener('fastcat:tauri-internal-file-drop', onTauriInternalFileDrop);
  window.addEventListener('drop', onWindowDragTerminated, true);
  window.addEventListener('dragend', onWindowDragTerminated, true);
  window.addEventListener('dragleave', onWindowDragLeave, true);
  if (runtimeConfig.public.e2eTest) {
    const e2eWindow = window as Window & FastcatE2eTimelineWindow;
    const persistE2eTimelineEdit = async () => {
      // E2E hooks are a testing bridge, not production UI flows. Persist edits
      // through the canonical save path so specs assert against a settled OTIO
      // file instead of the crash-recovery sidecar timing.
      await timelineStore.saveTimeline();
    };

    e2eWindow.__fastcatE2eSplitClipAtPlayhead = async () => {
      await timelineStore.splitClipAtPlayhead();
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eSelectTimelineItems = async ({ itemIds }) => {
      timelineStore.selectTimelineItems(itemIds);
    };

    e2eWindow.__fastcatE2eDeleteSelectedItems = async () => {
      const doc = timelineStore.timelineDoc;
      if (!doc) return;
      const ids = timelineStore.selectedItemIds;
      if (ids.length === 0) return;

      const byTrack = new Map<string, string[]>();
      for (const track of doc.tracks) {
        for (const item of track.items) {
          if (item.kind === 'clip' && ids.includes(item.id)) {
            byTrack.set(track.id, [...(byTrack.get(track.id) ?? []), item.id]);
          }
        }
      }

      for (const [trackId, itemIds] of byTrack) {
        timelineStore.applyTimeline({ type: 'delete_items', trackId, itemIds });
      }
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eUpdateClipProperties = async ({ itemId, properties }) => {
      const track = findE2eClipTrack(itemId);
      if (!track) throw new Error(`Timeline clip track not found: ${itemId}`);
      timelineStore.applyTimeline({
        type: 'update_clip_properties',
        trackId: track.id,
        itemId,
        properties,
      });
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eUpdateClipTransition = async ({ itemId, edge, transition }) => {
      const track = findE2eClipTrack(itemId);
      if (!track) throw new Error(`Timeline clip track not found: ${itemId}`);
      timelineStore.applyTimeline({
        type: 'update_clip_transition',
        trackId: track.id,
        itemId,
        ...(edge === 'in' ? { transitionIn: transition } : { transitionOut: transition }),
      });
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eSetCurrentTimeUs = async ({ us }) => {
      timelineStore.setCurrentTimeUs(Math.max(0, Math.round(us)));
    };

    e2eWindow.__fastcatE2eGetSelectedItemIds = async () => [...timelineStore.selectedItemIds];

    e2eWindow.__fastcatE2eSaveTimeline = async () => {
      await timelineStore.saveTimeline();
    };

    e2eWindow.__fastcatE2eSetTimelineZoom = async ({ zoom }) => {
      timelineStore.setTimelineZoomExact(zoom);
    };

    e2eWindow.__fastcatE2eAddTextClip = async ({ text, style, durationUs, trackId }) => {
      const itemIds = timelineStore.addTextClipAtPlayhead({ text, style, durationUs, trackId });
      await persistE2eTimelineEdit();
      return itemIds;
    };

    e2eWindow.__fastcatE2eAddProjectFileToTrack = async ({ path, trackId }) => {
      const name = path.split('/').pop() ?? path;
      await timelineStore.addClipToTimelineFromPath({
        path,
        trackId,
        name,
        startUs: 0,
      });
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eGetTimelineDocInfo = () => {
      const doc = timelineStore.timelineDoc;
      return {
        duration: timelineStore.duration,
        trackCount: doc?.tracks?.length ?? 0,
        tracks: (doc?.tracks ?? []).map((t) => ({
          id: t.id,
          kind: t.kind,
          videoHidden: t.videoHidden,
          clipCount: t.items.filter((it) => it.kind === 'clip').length,
          clipTypes: t.items
            .filter((it) => it.kind === 'clip')
            .map((it) => (it as { clipType?: string }).clipType),
        })),
      };
    };

    e2eWindow.__fastcatE2eAddMarker = async ({ timeUs, text, color, durationUs }) => {
      const id = createMarkerId();
      timelineStore.applyTimeline({
        type: 'add_marker',
        id,
        timeUs,
        text,
        color,
        ...(durationUs !== undefined ? { durationUs } : {}),
      });
      await persistE2eTimelineEdit();
      return id;
    };

    e2eWindow.__fastcatE2eAddMarkers = async ({ markers }) => {
      const entries = markers.map((marker) => ({ ...marker, id: createMarkerId() }));
      timelineStore.batchApplyTimeline(
        entries.map((marker) => ({
          type: 'add_marker' as const,
          id: marker.id,
          timeUs: marker.timeUs,
          text: marker.text,
          color: marker.color,
          ...(marker.durationUs !== undefined ? { durationUs: marker.durationUs } : {}),
        })),
      );
      await persistE2eTimelineEdit();
      return entries.map((marker) => marker.id);
    };

    e2eWindow.__fastcatE2eUpdateMarker = async ({ markerId, patch }) => {
      timelineStore.updateMarker(markerId, patch);
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eRemoveMarker = async ({ markerId }) => {
      timelineStore.removeMarker(markerId);
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eGetMarkers = async () => timelineStore.getMarkers();

    e2eWindow.__fastcatE2eTrimClip = async ({ itemId, edge, deltaUs }) => {
      const track = findE2eClipTrack(itemId);
      if (!track) throw new Error(`Timeline clip track not found: ${itemId}`);
      timelineStore.applyTimeline({
        type: 'trim_item',
        trackId: track.id,
        itemId,
        edge,
        deltaUs,
        quantizeToFrames: true,
      });
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eMoveClip = async ({ itemId, deltaUs }) => {
      const track = findE2eClipTrack(itemId);
      if (!track) throw new Error(`Timeline clip track not found: ${itemId}`);
      const item = track.items.find((it) => it.id === itemId);
      if (!item) throw new Error(`Timeline item not found: ${itemId}`);
      const startUs = Math.max(0, item.timelineRange.startUs + deltaUs);
      timelineStore.applyTimeline({
        type: 'move_item',
        trackId: track.id,
        itemId,
        startUs,
        quantizeToFrames: true,
      });
      await persistE2eTimelineEdit();
    };

    e2eWindow.__fastcatE2eMoveClipToTrack = async ({ itemId, toTrackId }) => {
      const fromTrack = findE2eClipTrack(itemId);
      if (!fromTrack) throw new Error(`Timeline clip track not found: ${itemId}`);
      const item = fromTrack.items.find((it) => it.id === itemId);
      if (!item) throw new Error(`Timeline item not found: ${itemId}`);
      timelineStore.applyTimeline({
        type: 'move_item_to_track',
        fromTrackId: fromTrack.id,
        toTrackId,
        itemId,
        startUs: item.timelineRange.startUs,
        quantizeToFrames: true,
      });
      await persistE2eTimelineEdit();
    };
  }
});

function onTrackAreaAuxClick(e: MouseEvent) {
  if (e.button !== 1) return;
  const isRuler = (e.target as HTMLElement).closest('.timeline-ruler-container');
  const isLabels = (e.target as HTMLElement).closest('.timeline-labels-container');
  if (!isRuler) {
    if (hasPanned.value || hasPlayheadMoved.value) return;
    if (isLabels) return;
    handleTimelineClickAction(timelineMouseSettings.value.middleClick, e);
  }
}

async function onClipAction(payload: TimelineClipActionPayload) {
  try {
    await applyClipAction(payload);
  } catch (err: unknown) {
    toast.add({
      title: t('common.error'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  }
}

function scrollPlayheadIntoView(params: { center?: boolean } = {}) {
  const el = scrollEl.value;
  if (!el) return;

  const playheadPx = timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom);
  const maxScrollLeft = el.scrollWidth - el.clientWidth;
  const nextScrollLeft = params.center
    ? computeTimelineCenteredScrollLeftForPlayhead({
        playheadPx,
        viewportWidth: el.clientWidth,
        maxScrollLeft,
      })
    : computeTimelineScrollLeftForPlayhead({
        playheadPx,
        scrollLeft: el.scrollLeft,
        viewportWidth: el.clientWidth,
        maxScrollLeft,
      });

  if (nextScrollLeft === null) {
    timelineStore.timelineScrollLeftPx = el.scrollLeft;
    return;
  }

  el.scrollLeft = nextScrollLeft;
  timelineStore.timelineScrollLeftPx = el.scrollLeft;
}

// Scroll the timeline so the playhead is visible (used after rewind to start/end)
watch(
  () => timelineStore.scrollToPlayheadRequest,
  () => {
    nextTick(scrollPlayheadIntoView);
  },
);

watch(
  () => timelineStore.centerPlayheadRequest,
  () => {
    nextTick(() => scrollPlayheadIntoView({ center: true }));
  },
);

watch(
  () => uiStore.speedModalTrigger,
  (trigger) => {
    if (trigger) {
      openSpeedModal(trigger.trackId, trigger.itemId, trigger.speed);
    }
  },
);

watch(
  masterScrollEl,
  (el) => {
    if (!el) return;
    nextTick(scrollPlayheadIntoView);
  },
  { immediate: true },
);

watch(
  () => [timelineStore.currentTime, timelineStore.isPlaying] as const,
  () => {
    if (!timelineStore.isPlaying || isPanning.value || isDraggingPlayhead.value) return;

    const el = scrollEl.value;
    if (!el) return;

    const playheadPx = timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom);
    const nextScrollLeft = computeTimelinePlaybackAutoScrollLeft({
      playheadPx,
      scrollLeft: el.scrollLeft,
      viewportWidth: el.clientWidth,
      maxScrollLeft: el.scrollWidth - el.clientWidth,
    });

    if (nextScrollLeft === null || Math.abs(nextScrollLeft - el.scrollLeft) < 1) return;

    el.scrollTo({
      left: nextScrollLeft,
      behavior: 'smooth',
    });
  },
);

function updateTrackHeight(trackId: string, height: number) {
  if (projectStore.isReadOnly || timelineStore.previewMode) return;
  trackHeights.value[trackId] = height;
  timelineStore.markTimelineAsDirty();
  timelineStore.requestTimelineSave();
}

async function onDrop(e: DragEvent, trackId: string) {
  if (timelineStore.previewMode) return;
  const startUs =
    dragPreview.value?.trackId === trackId ? dragPreview.value.startUs : getDropPosition(e);
  if (startUs === null) return;

  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) await handleFileDrop(files, trackId, startUs);
  clearDragPreview();
}

/**
 * Drops an in-memory payload onto the track under a screen point. Shared by the
 * Tauri OS-internal-drop bridge and the pointer-DnD drop zone (file-manager →
 * timeline). Resolves the track via hit-test, computes the start position, and
 * delegates to `handleLibraryDrop`.
 */
async function dropInternalPayloadAtPoint(params: {
  clientX: number;
  clientY: number;
  payload: unknown;
  options?: { pseudo?: boolean; clientX?: number; clientY?: number; showPresets?: boolean };
}) {
  const { clientX, clientY, payload } = params;
  if (!payload) return;

  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!target || !containerRef.value?.contains(target)) return;

  const trackEl = target.closest('[data-track-id]') as HTMLElement | null;
  const trackId = trackEl?.dataset.trackId;
  if (!trackEl || !trackId) return;

  const startUs =
    dragPreview.value?.trackId === trackId
      ? dragPreview.value.startUs
      : pxToTimeUs(clientX - trackEl.getBoundingClientRect().left, timelineStore.timelineZoom);

  await handleLibraryDrop(JSON.stringify(payload), trackId, startUs, params.options);
  clearDragPreview();
}

type FastcatE2eSplitClipAtPlayhead = () => Promise<void>;
type FastcatE2eSelectTimelineItems = (params: { itemIds: string[] }) => Promise<void>;
type FastcatE2eDeleteSelectedItems = () => Promise<void>;
type FastcatE2eUpdateClipProperties = (params: {
  itemId: string;
  properties: Record<string, unknown>;
}) => Promise<void>;
type FastcatE2eUpdateClipTransition = (params: {
  itemId: string;
  edge: 'in' | 'out';
  transition: ClipTransition | null;
}) => Promise<void>;
type FastcatE2eSetCurrentTimeUs = (params: { us: number }) => Promise<void>;
type FastcatE2eGetSelectedItemIds = () => Promise<string[]>;
type FastcatE2eAddTextClip = (params: {
  text?: string;
  style?: TextClipStyle;
  durationUs?: number;
  trackId?: string;
}) => Promise<string[]>;
type FastcatE2eAddMarker = (params: {
  timeUs: number;
  text?: string;
  color?: string;
  durationUs?: number;
}) => Promise<string | null>;
type FastcatE2eAddMarkers = (params: {
  markers: Array<{
    timeUs: number;
    text?: string;
    color?: string;
    durationUs?: number;
  }>;
}) => Promise<string[]>;
type FastcatE2eUpdateMarker = (params: {
  markerId: string;
  patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string };
}) => Promise<void>;
type FastcatE2eRemoveMarker = (params: { markerId: string }) => Promise<void>;
type FastcatE2eGetMarkers = () => Promise<TimelineMarker[]>;

type FastcatE2eGetTimelineDocInfo = () => {
  duration: number;
  trackCount: number;
  tracks: Array<{
    id: string;
    kind: string;
    videoHidden?: boolean;
    clipCount: number;
    clipTypes: Array<string | undefined>;
  }>;
};

interface FastcatE2eTimelineWindow {
  __fastcatE2eSplitClipAtPlayhead?: FastcatE2eSplitClipAtPlayhead;
  __fastcatE2eSelectTimelineItems?: FastcatE2eSelectTimelineItems;
  __fastcatE2eDeleteSelectedItems?: FastcatE2eDeleteSelectedItems;
  __fastcatE2eUpdateClipProperties?: FastcatE2eUpdateClipProperties;
  __fastcatE2eUpdateClipTransition?: FastcatE2eUpdateClipTransition;
  __fastcatE2eSetCurrentTimeUs?: FastcatE2eSetCurrentTimeUs;
  __fastcatE2eGetSelectedItemIds?: FastcatE2eGetSelectedItemIds;
  __fastcatE2eSaveTimeline?: () => Promise<void>;
  __fastcatE2eSetTimelineZoom?: (params: { zoom: number }) => Promise<void>;
  __fastcatE2eAddTextClip?: FastcatE2eAddTextClip;
  __fastcatE2eAddProjectFileToTrack?: (params: { path: string; trackId: string }) => Promise<void>;
  __fastcatE2eGetTimelineDocInfo?: FastcatE2eGetTimelineDocInfo;
  __fastcatE2eAddMarker?: FastcatE2eAddMarker;
  __fastcatE2eAddMarkers?: FastcatE2eAddMarkers;
  __fastcatE2eUpdateMarker?: FastcatE2eUpdateMarker;
  __fastcatE2eRemoveMarker?: FastcatE2eRemoveMarker;
  __fastcatE2eGetMarkers?: FastcatE2eGetMarkers;
  __fastcatE2eTrimClip?: (params: {
    itemId: string;
    edge: 'start' | 'end';
    deltaUs: number;
  }) => Promise<void>;
  __fastcatE2eMoveClip?: (params: { itemId: string; deltaUs: number }) => Promise<void>;
  __fastcatE2eMoveClipToTrack?: (params: { itemId: string; toTrackId: string }) => Promise<void>;
}

function findE2eClipTrack(itemId: string) {
  const doc = timelineStore.timelineDoc;
  if (!doc) return null;

  for (const track of doc.tracks) {
    if (track.items.some((item) => item.kind === 'clip' && item.id === itemId)) return track;
  }

  return null;
}

async function onTauriInternalFileDrop(event: Event) {
  const detail = (event as CustomEvent<TauriInternalFileDropDetail>).detail;
  if (!detail) return;
  await dropInternalPayloadAtPoint({
    clientX: detail.clientX,
    clientY: detail.clientY,
    payload: detail.payload ?? draggedFile.value,
  });
}

// --- pointer-DnD: file-manager (and other internal sources) → timeline -------
function trackElUnderPointer(clientX: number, clientY: number): HTMLElement | null {
  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!target || !containerRef.value?.contains(target)) return null;
  return target.closest('[data-track-id]') as HTMLElement | null;
}

function fileManagerPayloadToTimelinePayload(ctx: DndDragContext): unknown {
  const data = ctx.payload.data as FileManagerTimelineDndData | null | undefined;
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const isExternal =
    data?.primaryEntry?.source === 'remote' ||
    data?.primaryEntry?.path?.startsWith('/remote') === true ||
    items.some((item) => item.isExternal === true || item.path?.startsWith('/remote'));

  const timelineItems = items.map((item) => {
    const name = item.name ?? '';
    return {
      name,
      path: item.path ?? '',
      kind: name.toLowerCase().endsWith('.otio') ? 'timeline' : 'file',
      isExternal,
    };
  });

  return timelineItems.length === 1
    ? { ...timelineItems[0], isExternal }
    : { isExternal, items: timelineItems };
}

function resolveTimelineDndPayload(ctx: DndDragContext): unknown {
  if (ctx.payload.source === 'file-manager') {
    return fileManagerPayloadToTimelinePayload(ctx);
  }
  return ctx.payload.data;
}

function onTimelineDndOver(ctx: DndDragContext) {
  if (timelineStore.previewMode) {
    ctx.setOperation('cancel');
    clearDragPreview();
    return;
  }
  if (ctx.payload.source === 'file-manager') {
    const items = (ctx.payload.data as FileManagerTimelineDndData | null | undefined)?.items ?? [];
    const hasIncompatible = items.some(
      (item) => !checkFileTimelineCompatibility(item, mediaStore).compatible,
    );
    if (hasIncompatible) {
      ctx.setOperation('cancel');
      clearDragPreview();
      return;
    }
  }
  const trackEl = trackElUnderPointer(ctx.pointer.clientX, ctx.pointer.clientY);
  const trackId = trackEl?.dataset.trackId;
  if (!trackEl || !trackId) {
    clearDragPreview();
    ctx.setOperation('cancel');
    return;
  }
  ctx.setOperation('timeline-add');
  void buildPointerDragPreview({
    payload: resolveTimelineDndPayload(ctx),
    trackId,
    clientX: ctx.pointer.clientX,
    trackRectLeft: trackEl.getBoundingClientRect().left,
    pointer: ctx.pointer,
  });
}

function onNonTrackDragOver(e: DragEvent) {
  const types = e.dataTransfer?.types;
  if (types && Array.from(types).includes('Files')) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'none';
    }
  }
}

function onTimelineDndLeave() {
  clearDragPreview();
}

async function onTimelineDndDrop(ctx: DndDragContext) {
  if (timelineStore.previewMode) return;

  if (ctx.payload.source === 'file-manager') {
    const items = (ctx.payload.data as FileManagerTimelineDndData | null | undefined)?.items ?? [];
    for (const item of items) {
      const compat = checkFileTimelineCompatibility(item, mediaStore);
      if (!compat.compatible) {
        const errorMsg = compat.reasonKey ? t(compat.reasonKey) : t('common.error');
        toast.add({
          color: 'error',
          title: t('common.error'),
          description: errorMsg,
          icon: 'i-heroicons-x-circle',
        });
        return;
      }
    }
  }

  const payload = resolveTimelineDndPayload(ctx);
  if (!payload) return;

  const pseudo = isLayer1FromModifiers(ctx.pointer) || timelineSettingsStore.isPseudoOverlapEnabled;
  await dropInternalPayloadAtPoint({
    clientX: ctx.pointer.clientX,
    clientY: ctx.pointer.clientY,
    payload,
    options: {
      pseudo,
      clientX: ctx.pointer.clientX,
      clientY: ctx.pointer.clientY,
      showPresets: isLayer1FromModifiers(ctx.pointer),
    },
  });
}

function isLayer1FromModifiers(p: DndDragContext['pointer']): boolean {
  return isLayer1Pressed(
    {
      shiftKey: p.shiftKey,
      ctrlKey: p.ctrlKey,
      altKey: p.altKey,
      metaKey: p.metaKey,
    } as unknown as DragEvent,
    workspaceStore.userSettings,
  );
}

const { zoneAttrs: timelineDndZoneAttrs } = useDndDropZone(
  {
    // Internal sources that can be placed on the timeline. OS files keep the
    // HTML5 / Tauri path.
    canAccept: (payload) =>
      payload.source === 'file-manager' ||
      payload.source === 'library' ||
      payload.source === 'timeline-toolbar',
    onEnter: onTimelineDndOver,
    onOver: onTimelineDndOver,
    onLeave: onTimelineDndLeave,
    onDrop: onTimelineDndDrop,
  },
  'timeline',
);

const isCreateVersionModalOpen = ref(false);
const proposedVersionName = ref('');
const existingNamesInFolder = ref<string[]>([]);

async function handleCreateVersionFromPreview() {
  if (timelineStore.currentTimelinePath) {
    const parts = timelineStore.currentTimelinePath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    existingNamesInFolder.value = await projectStore.listEntryNames(parentPath);
  } else {
    existingNamesInFolder.value = [];
  }

  proposedVersionName.value = await timelineStore.getNextVersionName();
  isCreateVersionModalOpen.value = true;
}

function validateVersionName(newName: string): string | boolean | null {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const finalName = trimmed.toLowerCase().endsWith('.otio') ? trimmed : `${trimmed}.otio`;
  if (existingNamesInFolder.value.includes(finalName)) {
    return t('common.validation.exists');
  }
  return true;
}

async function handleConfirmCreateVersion(newName: string) {
  isCreateVersionModalOpen.value = false;
  if (timelineStore.previewBackupInfo) {
    await timelineStore.createVersionFromBackup(timelineStore.previewBackupInfo, newName);
  }
}
</script>

<template>
  <div
    ref="containerRef"
    v-bind="timelineDndZoneAttrs"
    data-testid="timeline-container"
    class="panel-focus-frame relative flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{ 'panel-focus-frame--active': focusStore.isPanelFocused('timeline') }"
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
    <TextPresetSelectionModal
      v-if="pendingClipInfo"
      v-model:open="isPresetModalOpen"
      :track-id="pendingClipInfo.trackId"
      :item-id="pendingClipInfo.itemId"
      @select="(id) => applyTextPreset(id, pendingClipInfo!)"
      @close="cancelTextPreset"
    />
    <UiEntityCreationModal
      v-model:open="isCreateVersionModalOpen"
      :title="t('fastcat.timeline.createVersion')"
      :confirm-label="t('common.confirm')"
      :default-value="proposedVersionName"
      select-without-extension
      :validate="validateVersionName"
      @confirm="handleConfirmCreateVersion"
    />

    <TimelineSpeedModal
      v-if="speedModal"
      v-model:open="speedModal.open"
      v-model:speed="speedModal.speed"
      :has-audio="speedModalTargetHasAudio"
      :is-audio-track="speedModalTargetIsAudioTrack"
      @save="saveSpeedModal"
    />

    <!-- Row 1: Toolbar -->
    <div class="shrink-0" @dragover="onNonTrackDragOver">
      <TimelineToolbar />
    </div>

    <!-- Backup Preview Banner -->
    <div
      v-if="timelineStore.previewMode"
      class="bg-amber-950/90 border-b border-amber-800/40 px-4 py-2 flex items-center justify-between text-xs text-amber-200 backdrop-blur-sm shrink-0"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-information-circle" class="w-4 h-4 text-amber-400 shrink-0" />
        <span>{{
          t('videoEditor.timeline.backups.previewBanner', {
            name: timelineStore.previewBackupInfo?.name,
          })
        }}</span>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          color="amber"
          variant="outline"
          class="cursor-pointer"
          @click="timelineStore.exitPreviewAndReload"
        >
          {{ t('videoEditor.timeline.backups.actionsLabel.return') }}
        </UButton>
        <UButton
          size="xs"
          color="amber"
          variant="solid"
          class="cursor-pointer"
          @click="handleCreateVersionFromPreview"
        >
          {{ t('fastcat.timeline.createVersion') }}
        </UButton>
      </div>
    </div>

    <FileManagerRemoteTransferProgressModal
      :open="isImporting"
      :title="t('videoEditor.fileManager.actions.importing')"
      :description="t('videoEditor.fileManager.actions.importing')"
      :progress="importProgress"
      :phase="importPhase"
      :file-name="importFileName"
      @cancel="cancelImport"
    />

    <!-- Row 2: Ruler with playhead timecode -->
    <div
      class="flex shrink-0 h-8 border-b border-ui-border"
      @click.self="timelineStore.selectTimelineProperties()"
      @pointermove="onTimelinePointerMove"
      @pointerup="onTimelinePointerUp"
      @pointercancel="onTimelinePointerUp"
      @dragover="onNonTrackDragOver"
    >
      <UContextMenu :items="emptyAreaContextMenuItems">
        <div
          class="shrink-0 border-r border-ui-border bg-ui-bg-elevated flex items-center px-2 gap-2 cursor-pointer"
          :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
          @click="
            timelineStore.selectTimelineProperties();
            selectionStore.selectTimelineProperties();
          "
        >
          <UiTimecode
            class="flex-1"
            :model-value="timelineStore.currentTime"
            :min="0"
            wheel-without-focus
            @update:model-value="timelineStore.setCurrentTimeUs($event)"
          />

          <div class="flex items-center gap-1">
            <UiTooltip
              v-for="button in trackResetButtons"
              :key="button.icon"
              :text="button.tooltip"
              :shortcuts="button.shortcuts"
            >
              <UButton
                :icon="button.icon"
                variant="solid"
                size="xs"
                :ui="{ leadingIcon: 'size-3' }"
                :class="['w-5 h-5 p-0! rounded-full justify-center', button.class]"
                :style="{ backgroundColor: button.color, color: button.textColor }"
                @click="button.onClick"
              />
            </UiTooltip>
          </div>
        </div>
      </UContextMenu>
      <div
        ref="rulerContainerRef"
        class="flex-1 min-w-0 relative z-10 timeline-ruler-container overflow-hidden bg-ui-bg-elevated"
      >
        <div
          class="absolute top-0 bottom-0 left-0 h-full"
          :style="{ right: `${scrollbarHeight}px` }"
        >
          <UContextMenu :items="emptyAreaContextMenuItems" class="w-full h-full">
            <TimelineRuler
              class="w-full h-full border-b border-ui-border bg-ui-bg-elevated cursor-pointer"
              :scroll-el="masterScrollEl"
              :scroll-left="scrollLeftRef"
              @pointerdown="onTimeRulerPointerDown"
              @start-playhead-drag="startPlayheadDrag"
              @start-pan="startPan"
            />
          </UContextMenu>
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
      <TimelineTrackSection
        ref="videoSectionRef"
        kind="video"
        :style="{ height: `${videoSectionPercent}%` }"
        :tracks="videoTracks"
        :track-heights="trackHeights"
        :can-edit-clip-content="canEditClipContent"
        :horizontal-scroll-el="masterScrollEl"
        :drag-preview="dragPreview"
        :move-preview="movePreview"
        :slip-preview="slipPreview"
        :trim-preview="trimPreview"
        :dragging-mode="draggingMode"
        :dragging-item-id="draggingItemId"
        :scroll-left="scrollLeftRef"
        :viewport-width="viewportWidth"
        :on-zoom-to-fit="fitTimelineZoom"
        @scroll="onVideoScroll"
        @labels-scroll="onVideoLabelsScroll"
        @click="onTimelineClick"
        @drop="onDrop"
        @dragover="(ev, id) => onTrackDragOver(ev, id)"
        @dragleave="(ev, id) => onTrackDragLeave(ev, id)"
        @start-move-item="startMoveItem"
        @select-item="selectItem"
        @start-trim-item="startTrimItem"
        @clip-action="onClipAction"
        @open-speed-modal="
          (p: TimelineOpenSpeedModalPayload) => openSpeedModal(p.trackId, p.itemId, p.speed)
        "
        @update-track-height="updateTrackHeight"
      />

      <!-- Section resize handle -->
      <div
        class="timeline-section-resize-handle h-1.5 cursor-ns-resize bg-ui-bg hover:bg-primary-500/30 transition-colors z-20 shrink-0 flex items-center justify-center group touch-none"
        @pointerdown="onSectionResizeStart"
      >
        <div
          class="w-8 h-0.5 rounded bg-ui-border group-hover:bg-primary-500/60 transition-colors"
        />
      </div>

      <!-- Audio Tracks Section -->
      <TimelineTrackSection
        ref="audioSectionRef"
        kind="audio"
        :tracks="audioTracks"
        :track-heights="trackHeights"
        :can-edit-clip-content="canEditClipContent"
        :horizontal-scroll-el="masterScrollEl"
        :drag-preview="dragPreview"
        :move-preview="movePreview"
        :slip-preview="slipPreview"
        :trim-preview="trimPreview"
        :dragging-mode="draggingMode"
        :dragging-item-id="draggingItemId"
        :scroll-left="scrollLeftRef"
        :viewport-width="viewportWidth"
        :on-zoom-to-fit="fitTimelineZoom"
        @scroll="onAudioScroll"
        @labels-scroll="onAudioLabelsScroll"
        @click="onTimelineClick"
        @drop="onDrop"
        @dragover="(ev, id) => onTrackDragOver(ev, id)"
        @dragleave="(ev, id) => onTrackDragLeave(ev, id)"
        @start-move-item="startMoveItem"
        @select-item="selectItem"
        @start-trim-item="startTrimItem"
        @clip-action="onClipAction"
        @open-speed-modal="
          (p: TimelineOpenSpeedModalPayload) => openSpeedModal(p.trackId, p.itemId, p.speed)
        "
        @update-track-height="updateTrackHeight"
      />

      <div class="flex shrink-0">
        <div class="shrink-0" :style="{ width: `${TRACK_LABELS_WIDTH}px` }" />
        <div
          ref="masterScrollEl"
          class="timeline-master-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          @scroll="onMasterScroll"
        >
          <div :style="timelineWidthStyle" class="h-px" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-master-scroll {
  height: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}
.timeline-master-scroll::-webkit-scrollbar {
  height: 10px;
}
.timeline-master-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.timeline-master-scroll::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.timeline-master-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
}
</style>
