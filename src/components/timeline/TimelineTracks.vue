<script setup lang="ts">
import { ref, computed, toRefs, watch, provide } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useMediaStore } from '~/stores/media.store';
import type {
  TimelineClipActionPayload,
  TimelineClipItem,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineTrack,
  TimelineTrackItem,
  TimelineTrimItemPayload,
  TrackKind,
} from '~/timeline/types';
import { timelineRangeToRoundedPx, timeUsToPx } from '~/utils/timeline/geometry';
import { useTimelineClipHandleResize } from '~/composables/timeline/useTimelineClipHandleResize';
import { useTimelineMarquee } from '~/composables/timeline/useTimelineMarquee';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';

import TimelineGap from './TimelineGap.vue';
import TimelineSpeedModal from './TimelineSpeedModal.vue';
import AutoMontageModal from './AutoMontageModal.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';
import { useTrackContextMenu } from '~/composables/timeline/useTrackContextMenu';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import { useSilenceTrimming } from '~/composables/timeline/useSilenceTrimming';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';

import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const focusStore = useFocusStore();
const mediaStore = useMediaStore();
const projectStore = useProjectStore();
const projectTabsStore = useProjectTabsStore();
const fileManagerStore = useFileManagerStore();
const fileManager = useFileManager();
const uiStore = useUiStore();
const clipboardStore = useAppClipboard();
const settingsStore = useTimelineSettingsStore();

provide('timelineContext', {
  zoom: computed(() => timelineStore.timelineZoom),
  fps: computed(() => timelineStore.fps),
  currentTime: computed(() => timelineStore.currentTime),
  isTrimModeActive: computed(() => timelineStore.isTrimModeActive),
  selectedItemIds: computed(() => timelineStore.selectedItemIds),
  userSettings: computed(() => workspaceStore.userSettings),
  missingPaths: computed(() => mediaStore.missingPaths),
  mediaMetadata: computed(() => mediaStore.mediaMetadata),
  clipboardPayload: computed(() => clipboardStore.clipboardPayload),
  hasTimelinePayload: computed(() => clipboardStore.hasTimelinePayload),
  timelineDoc: computed(() => timelineStore.timelineDoc),
  projectSettings: computed(() => projectStore?.projectSettings ?? {}),
  currentView: computed(() => projectStore?.currentView ?? ''),
  toolbarDragModeEnabled: computed(() => settingsStore.toolbarDragModeEnabled),
  toolbarDragMode: computed(() => settingsStore.toolbarDragMode),

  updateClipProperties: (trackId, itemId, props, options) =>
    timelineStore.updateClipProperties(trackId, itemId, props, options),
  updateClipTransition: (trackId, itemId, patch, options) =>
    timelineStore.updateClipTransition(trackId, itemId, patch, options),
  requestTimelineSave: (options) => timelineStore.requestTimelineSave(options),
  splitClipAtTime: (target, atUs) => timelineStore.splitClipAtTime(target, atUs),
  splitClipAtPlayhead: (target) => timelineStore.splitClipAtPlayhead(target),
  selectTimelineItems: (items) => timelineStore.selectTimelineItems(items),
  trimToPlayheadLeftNoRipple: (target) => timelineStore.trimToPlayheadLeftNoRipple(target),
  trimToPlayheadRightNoRipple: (target) => timelineStore.trimToPlayheadRightNoRipple(target),
  applyTimeline: (cmd) => timelineStore.applyTimeline(cmd),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  selectTransition: (payload) => timelineStore.selectTransition(payload),
  selectTimelineTransition: (trackId, itemId, edge) =>
    selectionStore.selectTimelineTransition(trackId, itemId, edge),
  selectTimelineItem: (trackId, itemId, kind) =>
    selectionStore.selectTimelineItem(trackId, itemId, kind),
  clearSelection: () => selectionStore.clearSelection(),
  setClipboardPayload: (payload) => clipboardStore.setClipboardPayload(payload),
  triggerScrollToEffects: () => uiStore.triggerScrollToEffects(),
  copySelectedClips: () => timelineStore.copySelectedClips() || [],
  cutSelectedClips: () => timelineStore.cutSelectedClips() || [],
  pasteClips: (options) => timelineStore.pasteClips(clipboardStore.clipboardPayload?.items || [], options),

  unlinkAudioFromVideo: (input) => timelineStore.unlinkAudioFromVideo(input),
  renameItem: (trackId, itemId, name) => timelineStore.renameItem(trackId, itemId, name),
  updateTrackProperties: (trackId, patch) => timelineStore.updateTrackProperties(trackId, patch),
  goToFiles: () => projectStore.goToFiles(),
  openTimelineFile: (path) => projectStore.openTimelineFile(path),
  goToCut: () => projectStore.goToCut(),
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  triggerScrollToFileTreeEntry: (path) => uiStore.triggerScrollToFileTreeEntry(path),
  openFolder: (entry) => fileManagerStore.openFolder(entry),
  selectFsEntry: (entry) => selectionStore.selectFsEntry(entry),
  setTempFocus: (panel) => focusStore.setTempFocus(panel),
  setPanelFocus: (panel) => focusStore.setPanelFocus(panel),
  loadProjectDirectory: () => fileManager.loadProjectDirectory(),
  findEntryByPath: (path) => fileManager.findEntryByPath(path),
  toggleDirectory: (entry) => fileManager.toggleDirectory(entry),
  setActiveTab: (tabId) => projectTabsStore.setActiveTab(tabId),

  mediaReplaceTarget: computed({
    get: () => uiStore.mediaReplaceTarget,
    set: (val) => { uiStore.mediaReplaceTarget = val; },
  }),
  isMediaReplaceModalOpen: computed({
    get: () => uiStore.isMediaReplaceModalOpen,
    set: (val) => { uiStore.isMediaReplaceModalOpen = val; },
  }),
});

const { selectedTransition } = storeToRefs(timelineStore);

const { isTrackVisuallySelected } = selectionStore;

const OVERSCAN_PX = 480;

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  canEditClipContent: boolean;
  scrollLeft?: number;
  viewportWidth?: number;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
  movePreview?: { itemId: string; trackId: string; startUs: number; isCollision?: boolean }[];
  slipPreview?: { itemId: string; trackId: string; deltaUs: number; timecode: string } | null;
  trimPreview?: {
    itemId: string;
    trackId: string;
    startUs: number;
    durationUs: number;
    edge: 'start' | 'end';
    deltaUs: number;
  } | null;
  draggingMode?: 'move' | 'slip' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
  isMobile?: boolean;
  onZoomToFit?: () => void;
}>();

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
  (e: 'long-press-item', itemId: string): void;
}>();

const DEFAULT_TRACK_HEIGHT = 40;
const containerRef = ref<HTMLElement | null>(null);

const { tracks, trackHeights } = toRefs(props);

interface TrackVisibilityIndexEntry {
  isSortedByStart: boolean;
  prefixMaxEndPositions: number[];
  startPositions: number[];
}

function buildClipRenderMemo(item: TimelineTrackItem): string {
  if (item.kind !== 'clip') {
    return [item.id, item.timelineRange.startUs, item.timelineRange.durationUs].join(':');
  }

  const clip = item as TimelineClipItem;
  return [
    clip.id,
    clip.timelineRange.startUs,
    clip.timelineRange.durationUs,
    clip.sourceRange?.startUs ?? '',
    clip.sourceRange?.durationUs ?? '',
    clip.name,
    clip.locked ? 1 : 0,
    clip.disabled ? 1 : 0,
    clip.audioMuted ? 1 : 0,
    clip.showWaveform !== false ? 1 : 0,
    clip.showThumbnails !== false ? 1 : 0,
    clip.audioWaveformMode ?? 'half',
    clip.audioGain ?? 1,
    clip.audioBalance ?? 0,
    clip.audioFadeInUs ?? 0,
    clip.audioFadeOutUs ?? 0,
    clip.audioFadeInCurve ?? 'linear',
    clip.audioFadeOutCurve ?? 'linear',
    clip.speed ?? 1,
    clip.freezeFrameSourceUs ?? '',
    clip.transitionIn?.type ?? '',
    clip.transitionIn?.durationUs ?? 0,
    clip.transitionIn?.curve ?? '',
    clip.transitionOut?.type ?? '',
    clip.transitionOut?.durationUs ?? 0,
    clip.transitionOut?.curve ?? '',
  ].join(':');
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/** Pre-calculate pixel geometries for items to avoid recalculating on every scroll/render frame */
const itemGeometries = computed(() => {
  const zoom = timelineStore.timelineZoom;
  const map = new Map<string, { startPx: number; widthPx: number; endPx: number }>();
  for (const track of props.tracks) {
    for (const item of track.items) {
      const geometry = timelineRangeToRoundedPx(item.timelineRange, zoom, 2);
      map.set(item.id, {
        startPx: geometry.leftPx,
        widthPx: geometry.widthPx,
        endPx: geometry.endPx,
      });
    }
  }
  return map;
});

const trackVisibilityIndexByTrack = computed<Record<string, TrackVisibilityIndexEntry>>(() => {
  const result: Record<string, TrackVisibilityIndexEntry> = {};
  const geos = itemGeometries.value;

  for (const track of props.tracks) {
    const startPositions: number[] = [];
    const prefixMaxEndPositions: number[] = [];
    let isSortedByStart = true;
    let lastStart = Number.NEGATIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    for (const item of track.items) {
      const geo = geos.get(item.id);
      if (!geo) {
        isSortedByStart = false;
        break;
      }

      startPositions.push(geo.startPx);
      if (geo.startPx < lastStart) {
        isSortedByStart = false;
      }
      lastStart = geo.startPx;
      maxEnd = Math.max(maxEnd, geo.endPx);
      prefixMaxEndPositions.push(maxEnd);
    }

    result[track.id] = {
      isSortedByStart,
      prefixMaxEndPositions,
      startPositions,
    };
  }

  return result;
});

const visibleStartPx = computed(() => Math.max(0, (props.scrollLeft ?? 0) - OVERSCAN_PX));
const visibleEndPx = computed(() => {
  const vw = props.viewportWidth ?? 0;
  if (vw <= 0) return Infinity;
  return (props.scrollLeft ?? 0) + vw + OVERSCAN_PX;
});

const visibleItemsByTrack = computed(() => {
  const result: Record<string, TimelineTrackItem[]> = {};
  const vStart = visibleStartPx.value;
  const vEnd = visibleEndPx.value;
  const geos = itemGeometries.value;
  const visibilityIndexByTrack = trackVisibilityIndexByTrack.value;

  for (const track of props.tracks) {
    if (vEnd === Infinity) {
      result[track.id] = track.items;
      continue;
    }

    const visibilityIndex = visibilityIndexByTrack[track.id];
    if (visibilityIndex?.isSortedByStart) {
      const startIndex = lowerBound(visibilityIndex.prefixMaxEndPositions, vStart);
      const endIndex = upperBound(visibilityIndex.startPositions, vEnd);

      if (startIndex >= endIndex) {
        result[track.id] = [];
        continue;
      }

      result[track.id] = track.items.slice(startIndex, endIndex).filter((item) => {
        const geo = geos.get(item.id);
        if (!geo) return true;
        return geo.endPx >= vStart && geo.startPx <= vEnd;
      });
      continue;
    }

    result[track.id] = track.items.filter((item) => {
      const geo = geos.get(item.id);
      if (!geo) return true;
      return geo.endPx >= vStart && geo.startPx <= vEnd;
    });
  }
  return result;
});

const trackViewModels = computed(() => {
  const hoveredTrackId = timelineStore.hoveredTrackId;
  const visibleItemsMap = visibleItemsByTrack.value;

  return props.tracks.map((track) => {
    const isDirectlySelected = isTrackDirectlySelected(track.id);
    const isVisuallySelected = isTrackVisuallySelected(track.id);
    const isHovered = hoveredTrackId === track.id;
    const height = props.trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;

    return {
      track,
      height,
      isDirectlySelected,
      isVisuallySelected,
      isHovered,
      visibleItems: visibleItemsMap[track.id] ?? [],
      clipRenderMemo: (visibleItemsMap[track.id] ?? []).map(buildClipRenderMemo).join('|'),
      selectionColor: track.color && track.color !== '#2a2a2a' ? `${track.color}80` : undefined,
      backgroundColor:
        track.color && track.color !== '#2a2a2a'
          ? isDirectlySelected
            ? `${track.color}40`
            : `${track.color}1a`
          : isDirectlySelected
            ? 'color-mix(in srgb, var(--selection-accent-500) 8%, transparent)'
            : undefined,
    };
  });
});

const { isMarqueeSelecting, marqueeStyle, startMarquee } = useTimelineMarquee(
  containerRef,
  tracks,
  trackHeights,
  () => props.scrollLeft ?? 0,
);

const workspaceStore = useWorkspaceStore();

function resolveTimelineDragAction(e: PointerEvent): string {
  const settings = workspaceStore.userSettings.mouse.timeline;
  if (e.button === 1) return settings.middleDrag;
  if (e.button === 0) {
    if (isLayer1Active(e, workspaceStore.userSettings)) return settings.clipDragShift;
    if (isLayer2Active(e, workspaceStore.userSettings)) return settings.clipDragCtrl;
    return settings.drag;
  }
  if (e.button === 2) return settings.clipDragRight;
  return 'none';
}

function shouldStartMarquee(e: PointerEvent): boolean {
  if (props.isMobile) return false;
  if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-track-id')) {
    return false;
  }
  const action = resolveTimelineDragAction(e);
  return action === 'move_clips' || action === 'select_area';
}

const { resizeVolume, startResizeVolume, startResizeFade, startResizeTransition } =
  useTimelineClipHandleResize(
    () => props.scrollLeft ?? 0,
    () => props.tracks,
  );

const timelineWidthPx = computed(() => {
  const maxUs = Math.max(timelineStore.duration, timelineStore.currentTime) + 30_000_000;
  return timeUsToPx(maxUs, timelineStore.timelineZoom);
});

const timelineContentStyle = computed(() => ({
  minWidth: `max(100%, ${timelineWidthPx.value}px)`,
  transform: `translate3d(-${props.scrollLeft ?? 0}px, 0, 0)`,
  willChange: 'transform',
}));

const selectionRangeStyle = computed(() => {
  const range = timelineStore.getSelectionRange();
  if (!range) return null;
  return {
    left: `${timeUsToPx(range.startUs, timelineStore.timelineZoom)}px`,
    width: `${Math.max(1, timeUsToPx(range.endUs - range.startUs, timelineStore.timelineZoom))}px`,
  };
});

// Auto Montage State
const autoMontageModal = ref<{ open: boolean; itemIds: string[] } | null>(null);
const { applySilenceTrimming } = useSilenceTrimming();

async function applyAutoMontage(settings: {
  trimStart: boolean;
  trimEnd: boolean;
  trimMiddle: boolean;
  mode: 'cut' | 'mark';
}) {
  if (!autoMontageModal.value) return;
  await applySilenceTrimming({
    clipIds: autoMontageModal.value.itemIds,
    settings,
  });
}


watch(
  () => uiStore.openAutoMontageTrigger,
  (val) => {
    if (!val) return;
    const hasAnyItem = props.tracks.some((track) =>
      track.items.some((item) => val.itemIds.includes(item.id)),
    );
    if (!hasAnyItem) return;
    autoMontageModal.value = {
      open: true,
      itemIds: val.itemIds,
    };
  },
);

function openAutoMontage(payload: TimelineClipActionPayload) {
  const entity = selectionStore.selectedEntity;
  let itemIds: string[] = [payload.itemId];

  if (entity?.source === 'timeline' && entity.kind === 'clips') {
    const ids = entity.items.map((it) => it.itemId);
    if (ids.includes(payload.itemId)) {
      itemIds = ids;
    }
  }

  autoMontageModal.value = {
    open: true,
    itemIds,
  };
}

// Speed Modal State
const speedModal = ref<{ open: boolean; trackId: string; itemId: string; speed: number } | null>(
  null,
);

function openSpeedModal(trackId: string, itemId: string, currentSpeed: number | null | undefined) {
  speedModal.value = {
    open: true,
    trackId,
    itemId,
    speed: typeof currentSpeed === 'number' ? currentSpeed : 1,
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const { trackId, itemId, speed } = speedModal.value;
  if (Math.abs(speed) < 0.1) return;
  timelineStore.updateClipProperties(trackId, itemId, { speed });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

const speedModalTargetHasAudio = computed(() => {
  if (!speedModal.value) return false;
  const track = props.tracks.find((t) => t.id === speedModal.value!.trackId);
  const clip = track?.items.find(
    (it): it is TimelineClipItem => it.id === speedModal.value!.itemId && it.kind === 'clip',
  );
  if (!clip || (track?.kind === 'video' && clip.audioFromVideoDisabled)) return false;
  if (track?.kind === 'audio') return true;
  return Boolean(clip.source?.path && mediaStore.mediaMetadata[clip.source.path]?.audio);
});

const { emptyAreaContextMenuItems: timelineEmptyAreaContextMenuItems } =
  useTimelineEmptyAreaContextMenu({
    onZoomToFit: () => props.onZoomToFit?.(),
  });

const isTrackRenameModalOpen = ref(false);
const trackToRename = ref<TimelineTrack | null>(null);

function handleRenameTrack(name: string) {
  if (trackToRename.value) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== trackToRename.value.name) {
      timelineStore.renameTrack(trackToRename.value.id, trimmed);
    }
  }
  isTrackRenameModalOpen.value = false;
  trackToRename.value = null;
}

const { getTrackContextMenuItems } = useTrackContextMenu({
  onRequestDelete: (track) => timelineStore.deleteTrack(track.id, { allowNonEmpty: true }),
  onRequestRename: (track) => {
    trackToRename.value = track;
    isTrackRenameModalOpen.value = true;
  },
  onPaste: (_trackId) => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    void timelineStore.pasteClips(payload.items, {
      insertStartUs: timelineStore.currentTime,
    });
    if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
  },
});

const trackContextMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const activeTrackForContextMenu = ref<TimelineTrack | null>(null);

function onTrackContextMenu(e: MouseEvent, track: TimelineTrack) {
  activeTrackForContextMenu.value = track;
  trackContextMenuRef.value?.open(e);
}

function handleTrackContextMenu(e: MouseEvent, track: TimelineTrack) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('[data-clip-id], [data-gap-id]')) {
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  onTrackContextMenu(e, track);
}

const activeTrackContextMenuItems = computed(() => {
  if (!activeTrackForContextMenu.value) return [];
  return getTrackContextMenuItems(activeTrackForContextMenu.value, props.tracks);
});

const activeMovePreviews = computed(() =>
  props.draggingMode === 'slip' ? [] : (props.movePreview ?? []),
);

const movePreviewItemsByTrack = computed(() => {
  const previews = activeMovePreviews.value;
  const itemMap = new Map<string, TimelineTrackItem>();

  for (const track of props.tracks) {
    for (const item of track.items) {
      itemMap.set(item.id, item);
    }
  }

  const result: Record<
    string,
    Array<{ preview: (typeof previews)[number]; item: TimelineTrackItem }>
  > = {};

  for (const preview of previews) {
    const item = itemMap.get(preview.itemId);
    if (!item) continue;
    if (!result[preview.trackId]) {
      result[preview.trackId] = [];
    }
    result[preview.trackId]!.push({ preview, item });
  }

  return result;
});
const movePreviewIds = computed(
  () => new Set(activeMovePreviews.value.map((preview) => preview.itemId)),
);
const movePreviewMemoByTrack = computed(() => {
  const result: Record<string, string> = {};

  for (const preview of activeMovePreviews.value) {
    if (!result[preview.trackId]) {
      result[preview.trackId] = '';
    }
    result[preview.trackId] +=
      `${preview.itemId}:${preview.startUs}:${preview.isCollision ? 1 : 0}|`;
  }

  return result;
});

function selectTransition(
  e: MouseEvent | PointerEvent,
  payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();

  // On mobile, skip the cycle logic — repeated tap just re-selects the same transition
  if (!props.isMobile) {
    // If this transition is already selected, toggle selection back to the clip
    const current = selectionStore.selectedEntity;
    if (
      current?.source === 'timeline' &&
      current.kind === 'transition' &&
      current.trackId === payload.trackId &&
      current.itemId === payload.itemId &&
      current.edge === payload.edge
    ) {
      timelineStore.selectTransition(null);
      timelineStore.selectTimelineItems([
        { trackId: payload.trackId, itemId: payload.itemId, kind: 'clip' },
      ]);
      return;
    }
  }

  timelineStore.selectTransition(payload);
  selectionStore.selectTimelineTransition(payload.trackId, payload.itemId, payload.edge);
}
function selectTrackById(trackId: string) {
  timelineStore.selectTrack(trackId);
  selectionStore.selectTimelineTrack(trackId);
}

/** True only when the track header itself is selected (not a clip/gap/transition on it). */
function isTrackDirectlySelected(trackId: string): boolean {
  const entity = selectionStore.selectedEntity;
  return entity?.source === 'timeline' && entity.kind === 'track' && entity.trackId === trackId;
}

let trackPointerStartX = 0;
let trackPointerStartY = 0;

function onTrackPointerDown(e: PointerEvent, trackId: string) {
  focusStore.setPanelFocus('timeline');
  if (shouldStartMarquee(e)) {
    // Stop propagation so the outer container doesn't call startMarquee without onClick and
    // override our callback. On click (no drag) → select the track; on drag → marquee.
    e.stopPropagation();
    if (!props.isMobile && e.button === 0) {
      startMarquee(e, () => selectTrackById(trackId));
    } else {
      startMarquee(e);
    }
  } else if (e.button === 0) {
    if (props.isMobile) {
      // On mobile, record start position for movement check in click handler
      trackPointerStartX = e.clientX;
      trackPointerStartY = e.clientY;
    } else {
      // Clips/gaps bubble their pointerdown up to the track. Only treat this as
      // a track-background press (select track + clear clip selection) when it
      // did not originate from a clip or gap — otherwise pressing a clip to drag
      // a multi-selection would wipe the selection here, leaving startMoveItem to
      // re-select just the grabbed clip and move only that one.
      const target = e.target as HTMLElement | null;
      const fromClipOrGap = Boolean(
        target?.closest('[data-clip-id]') || target?.closest('[data-gap-id]'),
      );
      if (!fromClipOrGap) {
        selectTrackById(trackId);
        timelineStore.clearSelection();
      }
    }
  }
}

function onTrackClick(e: MouseEvent, trackId: string) {
  if (!props.isMobile) return;
  e.stopPropagation();
  // Skip if this was a scroll gesture (significant pointer movement)
  const dx = Math.abs(e.clientX - trackPointerStartX);
  const dy = Math.abs(e.clientY - trackPointerStartY);
  if (dx > 5 || dy > 5) return;
  // Skip if click originated from a clip or gap child element
  const target = e.target as HTMLElement | null;
  if (target?.closest('[data-clip-id]') || target?.closest('[data-gap-id]')) return;
  selectTrackById(trackId);
  timelineStore.clearSelection();
}

// Paste Parameters Modal logic
const activeClipForPasteParameters = ref<TimelineClipItem | null>(null);
const activeTrackKindForPasteParameters = ref<TrackKind>('video');

const {
  isPasteParametersModalOpen,
  selectedParameterGroups,
  clipParameterGroupOptions,
  openPasteClipParameters,
  applyClipParameters,
} = useClipParametersClipboard({
  clip: computed(() => activeClipForPasteParameters.value || ({} as TimelineClipItem)),
  trackKind: computed(() => activeTrackKindForPasteParameters.value),
  updateClipProperties: (trackId, itemId, props) =>
    timelineStore.updateClipProperties(trackId, itemId, props),
  updateClipTransition: (trackId, itemId, patch) =>
    timelineStore.updateClipTransition(trackId, itemId, patch),
});

watch(
  () => uiStore.clipPasteParametersTrigger,
  (val) => {
    if (!val) return;
    const track = props.tracks.find((t) => t.id === val.trackId);
    if (!track) return;
    const clip = track.items.find(
      (it) => it.id === val.itemId && it.kind === 'clip',
    ) as TimelineClipItem;
    if (clip) {
      activeClipForPasteParameters.value = clip;
      activeTrackKindForPasteParameters.value = track.kind;
      // Opening is deferred to a macrotask inside the composable so it survives
      // being invoked from a closing context menu / dropdown layer.
      openPasteClipParameters(clip, track.kind);
    }
  },
);

watch(
  () => focusStore.effectiveFocus,
  (val) => {
    if (val === 'timeline') {
      containerRef.value?.focus();
    }
  },
);
</script>

<template>
  <UContextMenu :items="timelineEmptyAreaContextMenuItems" :disabled="isMobile">
    <div
      ref="containerRef"
      tabindex="-1"
      class="flex flex-col min-h-full relative outline-none"
      :style="timelineContentStyle"
      @pointerdown="
        focusStore.setPanelFocus('timeline');
        if (shouldStartMarquee($event)) {
          startMarquee($event);
        } else if ($event.button !== 1 && $event.target === $event.currentTarget) {
          timelineStore.clearSelection();
          selectionStore.clearSelection();
          timelineStore.selectTrack(null);
        }
      "
      @contextmenu.prevent.stop
    >
      <div
        v-if="selectionRangeStyle"
        class="absolute top-0 bottom-0 z-20 pointer-events-none border-l border-r border-selection-range-border bg-selection-range-bg shadow-[0_0_0_1px_rgba(var(--color-selection-range),0.25)]"
        :style="selectionRangeStyle"
      />

      <div
        v-if="isMarqueeSelecting"
        class="absolute border-2 border-primary-500 bg-primary-500/20 pointer-events-none z-50"
        :style="marqueeStyle"
      />

      <TimelineSpeedModal
        v-if="speedModal"
        v-model:open="speedModal.open"
        v-model:speed="speedModal.speed"
        :has-audio="speedModalTargetHasAudio"
        @save="saveSpeedModal"
      />

      <AutoMontageModal
        v-if="autoMontageModal"
        v-model:open="autoMontageModal.open"
        @apply="applyAutoMontage"
      />

      <UiContextMenuPortal
        ref="trackContextMenuRef"
        :items="activeTrackContextMenuItems"
        :target-el="containerRef"
        manual
      />

      <div
        v-for="trackViewModel in trackViewModels"
        :key="trackViewModel.track.id"
        v-memo="[
          trackViewModel.track.id,
          trackViewModel.track.locked,
          trackViewModel.track.color,
          trackViewModel.height,
          trackViewModel.isHovered,
          trackViewModel.isDirectlySelected,
          trackViewModel.isVisuallySelected,
          trackViewModel.visibleItems.length,
          trackViewModel.track.videoHidden,
          trackViewModel.track.audioMuted,
          trackViewModel.track.audioSolo,
          timelineStore.timelineZoom,
          timelineStore.isAnyTrackSoloed,
          trackViewModel.clipRenderMemo,
          movePreviewMemoByTrack[trackViewModel.track.id] ?? null,
          dragPreview?.trackId === trackViewModel.track.id ? dragPreview.startUs : null,
          trackViewModel.track.items.some((i) => i.id === draggingItemId) ? draggingItemId : null,
          trackViewModel.track.items.some((i) => movePreviewIds.has(i.id))
            ? (movePreviewMemoByTrack[trackViewModel.track.id] ?? null)
            : null,
          trackViewModel.track.items.some((i) => i.id === slipPreview?.itemId)
            ? slipPreview?.deltaUs
            : null,
          trackViewModel.track.items.some((i) => i.id === trimPreview?.itemId)
            ? trimPreview?.startUs
            : null,
          trackViewModel.track.items.some((i) => i.id === trimPreview?.itemId)
            ? trimPreview?.durationUs
            : null,
        ]"
        :data-track-id="trackViewModel.track.id"
        class="flex items-center relative transition-colors border-b border-ui-border"
        :class="[
          trackViewModel.isHovered && !trackViewModel.isVisuallySelected
            ? 'bg-ui-bg-elevated/50'
            : '',
          trackViewModel.track.locked ? 'hatching-diagonal-track bg-black/10' : '',
          trackViewModel.isDirectlySelected ? 'track--directly-selected' : '',
          !trackViewModel.isDirectlySelected && trackViewModel.isVisuallySelected
            ? 'track--visually-selected'
            : '',
        ]"
        :style="{
          height: `${trackViewModel.height}px`,
          '--track-selection-color': trackViewModel.selectionColor,
          backgroundColor: trackViewModel.backgroundColor,
        }"
        @pointerdown="onTrackPointerDown($event, trackViewModel.track.id)"
        @click="onTrackClick($event, trackViewModel.track.id)"
        @mouseenter="timelineStore.hoveredTrackId = trackViewModel.track.id"
        @mouseleave="timelineStore.hoveredTrackId = null"
        @dragover.prevent="emit('dragover', $event, trackViewModel.track.id)"
        @drop.prevent="emit('drop', $event, trackViewModel.track.id)"
        @contextmenu="handleTrackContextMenu($event, trackViewModel.track)"
      >
        <!-- Drop Previews inside track -->
        <div
          v-if="dragPreview && dragPreview.trackId === trackViewModel.track.id"
          class="absolute top-0.5 bottom-0.5 rounded px-2 flex items-center text-xs text-(--clip-text) z-30 pointer-events-none opacity-80"
          :class="
            dragPreview.kind === 'file'
              ? 'bg-primary-600 border border-primary-400'
              : 'bg-ui-bg-accent border border-ui-border'
          "
          :style="{
            left: `${timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
            width: `${Math.max(2, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
          }"
        >
          <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
        </div>

        <TimelineClip
          v-for="{ preview, item: previewItem } in movePreviewItemsByTrack[
            trackViewModel.track.id
          ] ?? []"
          :key="`preview-${preview.itemId}`"
          class="opacity-60 pointer-events-none z-40!"
          :track="trackViewModel.track"
          :item="
            {
              ...previewItem,
              id: 'preview-' + previewItem.id,
              timelineRange: { ...previewItem.timelineRange, startUs: preview.startUs },
            } as TimelineTrackItem
          "
          :track-height="trackViewModel.height"
          :can-edit-clip-content="false"
          :is-dragging-current-item="false"
          :is-move-preview-current-item="true"
          :is-move-preview-collision="preview.isCollision"
          :selected-transition="null"
          :resize-volume="null"
        />

        <template v-for="item in trackViewModel.visibleItems" :key="item.id">
          <TimelineGap
            v-if="item.kind === 'gap'"
            :item="item"
            :track-id="trackViewModel.track.id"
            :is-mobile="isMobile"
            @select="(e) => emit('selectItem', e, item.id)"
            @marquee-start="
              (e) => !isMobile && startMarquee(e, () => emit('selectItem', e, item.id))
            "
          />
          <TimelineClip
            v-else
            :track="trackViewModel.track"
            :item="item"
            :track-height="trackViewModel.height"
            :can-edit-clip-content="canEditClipContent"
            :is-dragging-current-item="draggingItemId === item.id"
            :is-move-preview-current-item="movePreviewIds.has(item.id)"
            :is-trim-preview-current-item="trimPreview?.itemId === item.id"
            :selected-transition="selectedTransition"
            :resize-volume="resizeVolume"
            :scroll-left="scrollLeft"
            :viewport-width="viewportWidth"
            :slip-preview="slipPreview?.itemId === item.id ? slipPreview : null"
            :trim-preview="trimPreview?.itemId === item.id ? trimPreview : null"
            :is-mobile="isMobile"
            @select-item="(ev, id) => emit('selectItem', ev, id)"
            @start-move-item="(ev, payload) => emit('startMoveItem', ev, payload)"
            @start-trim-item="(ev, payload) => emit('startTrimItem', ev, payload)"
            @start-resize-volume="startResizeVolume"
            @start-resize-fade="startResizeFade"
            @start-resize-transition="startResizeTransition"
            @select-transition="selectTransition"
            @clip-action="
              (p) => {
                if (p.action === 'openAutoMontage') {
                  openAutoMontage(p);
                } else if (p.action === 'longPress') {
                  emit('long-press-item', p.itemId);
                } else {
                  emit('clipAction', p);
                }
              }
            "
            @open-speed-modal="
              (p: TimelineOpenSpeedModalPayload) =>
                openSpeedModal(trackViewModel.track.id, p.itemId, p.speed)
            "
            @reset-volume="
              (payload) =>
                timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
                  audioGain: 1,
                })
            "
          />
        </template>
      </div>
      <div class="w-full flex-1 min-h-7" @click="timelineStore.selectTrack(null)" />
      <div class="h-16 shrink-0" />
    </div>
  </UContextMenu>

  <UiRenameModal
    :open="isTrackRenameModalOpen"
    :current-name="trackToRename?.name || ''"
    :title="t('fastcat.timeline.renameTrack')"
    @update:open="isTrackRenameModalOpen = $event"
    @rename="handleRenameTrack"
  />

  <UiRenameModal
    :open="!!uiStore.pendingClipRename"
    :current-name="uiStore.pendingClipRename?.name || ''"
    :title="t('fastcat.clip.rename')"
    @update:open="if (!$event) uiStore.pendingClipRename = null;"
    @rename="
      if (uiStore.pendingClipRename) {
        timelineStore.renameItem(
          uiStore.pendingClipRename.trackId,
          uiStore.pendingClipRename.itemId,
          $event,
        );
        uiStore.pendingClipRename = null;
      }
    "
  />

  <ClipParametersPasteModal
    v-model:open="isPasteParametersModalOpen"
    v-model:selected-groups="selectedParameterGroups"
    :groups="clipParameterGroupOptions"
    @apply="applyClipParameters"
  />
</template>

<style scoped>
/* Псевдоэлементы для подсветки выбора трека вместо лишних DOM-узлов */
[data-track-id]::before,
[data-track-id]::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  transition:
    background-color 0.2s,
    border-color 0.2s;
  border-style: solid;
  border-width: 0;
}

/* Яркая подсветка когда выбран сам хедер трека */
.track--directly-selected::before {
  border-top-width: 2px;
  border-bottom-width: 2px;
  border-color: var(--track-selection-color, rgba(var(--color-primary-500), 0.4));
  background-color: rgba(var(--color-primary-500), 0.1);
}

/* Мягкая подсветка когда выбран клип на треке */
.track--visually-selected::after {
  border-top-width: 1px;
  border-bottom-width: 1px;
  border-color: var(--track-selection-color, rgba(var(--color-primary-500), 0.4));
}
</style>
