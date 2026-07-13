import { TICKS_PER_SECOND } from '~/utils/time';
import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, ref, toRaw } from 'vue';

import type { TimelineTrack, TimelineMoveItemPayload, TimelineDocument } from '~/timeline/types';
import {
  buildMultiItemMoves,
  computeSnapTargetsUs,
  getSelectedMovableItemIds,
  resolveMoveTargetTrackId,
} from '~/composables/timeline/timeline-drag-domain';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { cloneValue } from '~/utils/clone';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import {
  getTimelineCommandLabelKey,
  getUpdateClipPropertiesLabelKey,
} from '~/stores/timeline/history-labels';

import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { isCommandMatched } from '~/utils/hotkeys/runtime';

import {
  zoomToPxPerSecond,
  pxToDeltaUs,
  quantizeDeltaUsToFrames,
  quantizeStartUsToFrames,
  subframePhaseUs,
  pickBestSnapCandidateUs,
  computeSnappedStartUs,
} from '~/utils/timeline/geometry';
import { sanitizeFps, getLinkedClipGroupItemIds, findClipById } from '~/timeline/commands/utils';
import { computeTrimGeometry } from '~/timeline/commands/item/trimGeometry';
import { formatStopFrameTimecode } from '~/utils/stop-frames';
import { useTimelinePointerSession } from '~/composables/timeline/useTimelinePointerSession';
import { useTimelineEdgeScroll } from '~/composables/timeline/useTimelineEdgeScroll';
import type { TimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationUs } from '~/timeline/selectors';

interface DragApplyContext {
  mode: 'move' | 'slip' | 'trim_start' | 'trim_end';
  trackId: string;
  itemId: string;
  clientX: number;
  clientY: number;
  fps: number;
  zoom: number;
  enableFrameSnap: boolean;
  enableClipSnap: boolean;
  snapThresholdPx: number;
  overlapMode: 'pseudo' | 'none';
  isAudioOnly: boolean;
}

export interface TimelineMovePreview {
  itemId: string;
  trackId: string;
  startUs: number;
  isCollision?: boolean;
}

export interface TimelineSlipPreview {
  itemId: string;
  trackId: string;
  deltaUs: number;
  timecode: string;
}

export interface TimelineTrimPreview {
  itemId: string;
  trackId: string;
  startUs: number;
  durationUs: number;
  edge: 'start' | 'end';
  deltaUs: number;
}

export function useTimelineItemDrag(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const settingsStore = useTimelineSettingsStore();
  const selectionStore = useSelectionStore();
  const workspaceStore = useWorkspaceStore();
  const { bindSession, clearSession, scheduleUpdate } = useTimelinePointerSession();
  const toast = useToast();
  const { t } = useI18n();

  const draggingItemId = ref<string | null>(null);
  const draggingTrackId = ref<string | null>(null);
  const dragOriginTrackId = ref<string | null>(null);
  const draggingMode = ref<'move' | 'slip' | 'trim_start' | 'trim_end' | null>(null);
  const dragAnchorClientX = ref(0);
  const dragAnchorScrollLeft = ref(0);
  const dragAnchorStartUs = ref(0);
  const dragAnchorDurationUs = ref(0);
  const dragAnchorSourceStartUs = ref(0);
  const dragAnchorSourceDurationUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const dragSnapTargetsUs = ref<number[]>([]);
  const dragAnchorItemDurationUs = ref(0);
  const hasPendingTimelinePersist = ref(false);
  const lastDragClientX = ref(0);
  const lastDragClientY = ref(0);
  const pendingDragClientX = ref<number | null>(null);
  const pendingDragClientY = ref<number | null>(null);

  const movePreview = ref<TimelineMovePreview[]>([]);
  const slipPreview = ref<TimelineSlipPreview | null>(null);
  const trimPreview = ref<TimelineTrimPreview[]>([]);
  const pendingMoveCommit = ref<{
    moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }>;
    isCollision?: boolean;
  } | null>(null);
  const pendingTrimCommit = ref<{
    targetTrackId: string;
    targetItemId: string;
    edge: 'start' | 'end';
    deltaUs: number;
    quantizeToFrames: boolean;
    commandType: 'trim_item' | 'trim_items' | 'overlay_trim_item';
  } | null>(null);

  const { hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();

  const dragStartSnapshot = ref<TimelineDocument | null>(null);
  const lastDragAppliedCmd = ref<TimelineCommand | null>(null);
  const dragCancelRequested = ref(false);
  const dragIsFreeOverride = ref(false);
  const dragUsePseudoOverlapOverride = ref(false);
  const dragDisableFrameSnapOverride = ref(false);
  const dragIsCopyOverride = ref(false);
  const dragToggleSnapOverride = ref(false);
  const dragPointerButton = ref<0 | 2>(0);
  const dragIsMobileTouch = ref(false);
  const isTrimEdgeBlocked = ref(false);

  function getToolbarSnapAction(): 'snap' | 'no_snap' {
    return settingsStore.toolbarSnapMode;
  }

  /**
   * Frame quantization for a drag. Only audio-only drags may be sub-frame:
   * every non-audio (or mixed) drag stays frame-locked regardless of the free
   * override or the `freeAudioPlacement` setting. Free positioning is audio-only.
   */
  function resolveDragFrameSnap(isAudioOnly: boolean): boolean {
    if (!isAudioOnly) return true;
    const freeSubframe = settingsStore.freeAudioPlacement || dragDisableFrameSnapOverride.value;
    return !freeSubframe;
  }

  function getToolbarDragAction(): ToolbarDragMode | 'none' {
    if (!settingsStore.toolbarDragModeEnabled) {
      return 'none';
    }

    return settingsStore.toolbarDragMode;
  }

  function resolveDragAction(
    event: PointerEvent | KeyboardEvent | MouseEvent,
    pointerButton: 0 | 2,
  ): string {
    const settings = workspaceStore.userSettings.mouse.timeline;

    if (pointerButton === 2) {
      return settings.clipDragRight;
    }

    if (isLayer1Active(event as MouseEvent | KeyboardEvent, workspaceStore.userSettings)) {
      return settings.clipDragShift;
    }

    if (isLayer2Active(event as MouseEvent | KeyboardEvent, workspaceStore.userSettings)) {
      return settings.clipDragCtrl;
    }

    return 'none';
  }

  function applyDragAction(action: string) {
    let snapAction: 'snap' | 'no_snap' | 'free_mode' = getToolbarSnapAction();
    let dragAction = getToolbarDragAction();

    if (action === 'none') {
      action = '';
    }

    if (action === 'pseudo_overlap' || action === 'copy' || action === 'slip') {
      dragAction = action;
    } else if (action === 'free_mode' || action === 'no_snap' || action === 'snap') {
      snapAction = action;
      dragAction = 'none';
    }

    // `free_mode` can only come from a mouse-modifier action here (the toolbar
    // snap mode is snap/no_snap). It is honored per-drag but only takes effect
    // for audio-only drags (see resolveDragFrameSnap / the free-override gating).
    dragIsFreeOverride.value = snapAction === 'free_mode';
    dragUsePseudoOverlapOverride.value = dragAction === 'pseudo_overlap';
    dragDisableFrameSnapOverride.value = snapAction === 'free_mode';
    dragIsCopyOverride.value = dragAction === 'copy';
    dragToggleSnapOverride.value = action === 'toggle_snap';
  }

  function canSlipClip(
    payloadMode: TimelineMoveItemPayload['mode'],
    item: TimelineTrack['items'][number] | undefined,
  ): boolean {
    if (payloadMode !== 'slip') return false;
    if (!item || item.kind !== 'clip') return false;
    if (item.clipType !== 'media' && item.clipType !== 'timeline') return false;
    if (item.isImage) return false;

    const sourceDurationUs = Math.max(0, Math.round(Number(item.sourceDurationUs ?? 0)));
    const sourceRangeDurationUs = Math.max(0, Math.round(Number(item.sourceRange.durationUs ?? 0)));

    return sourceDurationUs > sourceRangeDurationUs;
  }

  function scheduleDragReapplyFromLastPointerPosition() {
    if (!draggingMode.value) return;
    if (
      (draggingMode.value === 'trim_start' || draggingMode.value === 'trim_end') &&
      isTrimEdgeBlocked.value
    ) {
      return false;
    }

    pendingDragClientX.value = lastDragClientX.value;
    pendingDragClientY.value = lastDragClientY.value;
    scheduleDragApply();
    return true;
  }

  const { updateEdgeScroll, stopEdgeScroll } = useTimelineEdgeScroll({
    scrollEl,
    isActive: computed(() => draggingMode.value !== null),
    onScrollStep: scheduleDragReapplyFromLastPointerPosition,
    shouldContinue: () => !isTrimEdgeBlocked.value,
  });

  function bindDragSession() {
    bindSession({
      onPointerMove: onGlobalPointerMove,
      onPointerUp: onGlobalPointerUp,
      onKeyDown: onGlobalKeyDown,
      onKeyUp: onGlobalKeyUp,
    });
  }

  function startMoveItem(e: PointerEvent, payload: TimelineMoveItemPayload) {
    const { trackId, itemId, startUs } = payload;

    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();

    const track = tracks.value.find((t) => t.id === trackId);
    if (track?.locked) return;

    const item = track?.items.find((it) => it.id === itemId);
    if (item?.kind === 'clip' && Boolean(item.locked)) return;

    if (!timelineStore.selectedItemIds.includes(itemId)) {
      const doc = timelineStore.timelineDoc;
      const groupedIds = doc ? getLinkedClipGroupItemIds(doc, itemId) : [itemId];
      timelineStore.selectTimelineItems(groupedIds);

      const groupedItems = tracks.value
        .flatMap((t) => t.items.map((it) => ({ trackId: t.id, item: it })))
        .filter((x) => groupedIds.includes(x.item.id))
        .map((x) => ({ trackId: x.trackId, itemId: x.item.id }));

      const canOpenClipProperties =
        projectStore.currentView === 'cut' || projectStore.currentView === 'sound';
      if (canOpenClipProperties) {
        selectionStore.selectTimelineItems(groupedItems);
      }
    }

    draggingMode.value = canSlipClip(payload.mode, item) ? 'slip' : 'move';
    draggingTrackId.value = trackId;
    dragOriginTrackId.value = trackId;
    draggingItemId.value = itemId;
    dragAnchorClientX.value = e.clientX;
    dragAnchorScrollLeft.value = scrollEl.value?.scrollLeft ?? 0;
    lastDragClientX.value = e.clientX;
    lastDragClientY.value = e.clientY;
    dragPointerButton.value = e.button as 0 | 2;
    applyDragAction(resolveDragAction(e, dragPointerButton.value));

    dragAnchorStartUs.value = startUs;
    dragIsMobileTouch.value = e.pointerType === 'touch';
    isTrimEdgeBlocked.value = false;
    dragAnchorDurationUs.value =
      tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId)
        ?.timelineRange.durationUs ?? 0;
    dragAnchorSourceStartUs.value = item?.kind === 'clip' ? item.sourceRange.startUs : 0;
    dragAnchorSourceDurationUs.value = item?.kind === 'clip' ? item.sourceRange.durationUs : 0;
    dragAnchorItemDurationUs.value = dragAnchorDurationUs.value;
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const snapSettings = workspaceStore.userSettings.timeline.snapping;
    // Exclude every selected movable clip — when moving a group, its own members
    // must not act as snap targets, otherwise the group sticks to itself.
    const moveExcludeItemIds = getSelectedMovableItemIds({
      selectedItemIds: timelineStore.selectedItemIds,
      tracks: tracks.value,
    });
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemIds: moveExcludeItemIds.length > 0 ? moveExcludeItemIds : [itemId],
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
      includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });

    dragStartSnapshot.value = toRaw(timelineStore.timelineDoc) as TimelineDocument | null;
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;
    isTrimEdgeBlocked.value = false;

    movePreview.value = [{ itemId, trackId, startUs }];
    pendingMoveCommit.value = null;
    slipPreview.value = null;
    trimPreview.value = [];
    pendingTrimCommit.value = null;

    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    bindDragSession();
  }

  function startTrimItem(
    e: PointerEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();

    const track = tracks.value.find((t) => t.id === input.trackId);
    if (track?.locked) return;

    const item = track?.items.find((it) => it.id === input.itemId);
    if (item?.kind === 'clip' && Boolean(item.locked)) return;

    const doc = timelineStore.timelineDoc;

    const targetItemId = input.itemId;
    const targetTrackId = input.trackId;

    draggingMode.value = input.edge === 'start' ? 'trim_start' : 'trim_end';
    draggingTrackId.value = targetTrackId;
    draggingItemId.value = targetItemId;
    dragAnchorClientX.value = e.clientX;
    dragAnchorScrollLeft.value = scrollEl.value?.scrollLeft ?? 0;
    lastDragClientX.value = e.clientX;
    lastDragClientY.value = e.clientY;
    dragPointerButton.value = e.button as 0 | 2;
    applyDragAction(resolveDragAction(e, dragPointerButton.value));

    dragAnchorStartUs.value = input.startUs;
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const currentItem = tracks.value
      .find((t) => t.id === targetTrackId)
      ?.items.find((it) => it.id === targetItemId);
    const durationUs = currentItem?.kind === 'clip' ? currentItem.timelineRange.durationUs : 0;
    dragAnchorItemDurationUs.value = Math.max(0, Math.round(Number(durationUs ?? 0)));

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const snapSettings = workspaceStore.userSettings.timeline.snapping;

    const groupedIds = doc ? getLinkedClipGroupItemIds(doc, targetItemId) : [targetItemId];
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemIds: groupedIds,
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
      includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });

    dragStartSnapshot.value = toRaw(timelineStore.timelineDoc) as TimelineDocument | null;
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;
    isTrimEdgeBlocked.value = false;
    movePreview.value = [];
    pendingMoveCommit.value = null;
    slipPreview.value = null;

    const previewItems: TimelineTrimPreview[] = [];
    const seen = new Set<string>();

    for (const id of groupedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const tr = tracks.value.find((t) => t.items.some((it) => it.id === id));
      const it = tr?.items.find((x) => x.id === id);
      if (it?.kind === 'clip') {
        previewItems.push({
          itemId: id,
          trackId: tr!.id,
          startUs: it.timelineRange.startUs,
          durationUs: it.timelineRange.durationUs,
          edge: input.edge,
          deltaUs: 0,
        });
      }
    }

    trimPreview.value = previewItems;
    pendingTrimCommit.value = null;

    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    bindDragSession();
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel) {
      if (!draggingMode.value) return;

      dragCancelRequested.value = true;
      e.preventDefault();
      onGlobalPointerUp();
      return;
    }

    applyDragAction(resolveDragAction(e, dragPointerButton.value));
    scheduleDragReapplyFromLastPointerPosition();
  }

  function onGlobalKeyUp(e: KeyboardEvent) {
    if (!draggingMode.value) return;

    applyDragAction(resolveDragAction(e, dragPointerButton.value));
    scheduleDragReapplyFromLastPointerPosition();
  }

  function getDragDeltaUs(clientX: number, zoom: number): number {
    const currentScrollLeft = scrollEl.value?.scrollLeft ?? 0;
    const dxPx =
      clientX - dragAnchorClientX.value + (currentScrollLeft - dragAnchorScrollLeft.value);

    return pxToDeltaUs(dxPx, zoom);
  }

  function applySlipDrag(ctx: DragApplyContext) {
    const { trackId, itemId, clientX, fps, zoom } = ctx;
    const track = tracks.value.find((value) => value.id === trackId);
    const item = track?.items.find((value) => value.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const rawDeltaUs = getDragDeltaUs(clientX, zoom);
    const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
    const absSpeed = Math.abs(speed);
    const sourceDeltaUs = rawDeltaUs * absSpeed;

    const maxSourceStartUs = Math.max(
      0,
      Math.round(Number(item.sourceDurationUs ?? 0) - dragAnchorSourceDurationUs.value),
    );
    const nextSourceStartUs = Math.min(
      maxSourceStartUs,
      Math.max(0, Math.round(dragAnchorSourceStartUs.value - sourceDeltaUs)),
    );
    const deltaUs = nextSourceStartUs - dragAnchorSourceStartUs.value;

    slipPreview.value = {
      itemId,
      trackId,
      deltaUs,
      timecode: `${deltaUs >= 0 ? '+' : '-'}${formatStopFrameTimecode({
        timeUs: Math.abs(deltaUs),
        fps,
        frameDigits: 1,
      })}`,
    };

    const cmd: Extract<TimelineCommand, { type: 'update_clip_properties' }> = {
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: {
        sourceRange: {
          ...item.sourceRange,
          startUs: nextSourceStartUs,
          durationUs: dragAnchorSourceDurationUs.value,
        },
      },
    };

    timelineStore.applyTimeline(cmd, {
      saveMode: 'none',
      skipHistory: true,
    });
    lastDragAppliedCmd.value = cmd;
    hasPendingTimelinePersist.value = true;
  }

  function applyMoveDrag(ctx: DragApplyContext) {
    const {
      trackId,
      itemId,
      clientX,
      clientY,
      fps,
      zoom,
      enableFrameSnap,
      enableClipSnap,
      snapThresholdPx,
      overlapMode,
      isAudioOnly,
    } = ctx;

    const rawDeltaUs = getDragDeltaUs(clientX, zoom);
    const rawStartUs = Math.max(0, dragAnchorStartUs.value + rawDeltaUs);

    const selectedMovableItemIds = getSelectedMovableItemIds({
      selectedItemIds: timelineStore.selectedItemIds,
      tracks: tracks.value,
    });

    // Preserve the clip's sub-frame phase when frame-snapping. A free (off-grid)
    // audio clip carries a deliberate sub-frame offset — e.g. a hand-dialed
    // multi-mic sync. Frame-snapping it by delta (via `frameOffsetUs`) translates
    // it by whole frames while keeping that phase, instead of re-quantizing the
    // absolute start onto the grid and destroying the sync. Only audio can be
    // free, so non-audio drags always use phase 0 (locked to the absolute grid).
    const frameOffsetUs = isAudioOnly ? subframePhaseUs(dragAnchorStartUs.value, fps) : 0;

    const startUs = computeSnappedStartUs({
      rawStartUs,
      draggingItemDurationUs: dragAnchorDurationUs.value,
      fps,
      zoom,
      snapThresholdPx,
      snapTargetsUs: dragSnapTargetsUs.value,
      enableFrameSnap,
      enableClipSnap,
      frameOffsetUs,
    });

    const targetTrackId = resolveMoveTargetTrackId({
      clientX,
      clientY,
      draggingTrackId: trackId,
      tracks: tracks.value,
    });

    const isMulti = selectedMovableItemIds.includes(itemId) && selectedMovableItemIds.length > 1;

    if (isMulti && dragStartSnapshot.value) {
      // Quantize the group's shared delta (not each member's absolute start) so a
      // group with mixed on-grid / off-grid clips translates rigidly and every
      // member keeps its own sub-frame phase. The commit sets `preserveItemOffsets`
      // so `move_items` applies these starts verbatim instead of re-snapping the
      // off-grid members onto the frame grid. Mirrors the linked-clip move path.
      const rawDeltaUs = startUs - dragAnchorStartUs.value;
      const deltaUs = enableFrameSnap ? quantizeDeltaUsToFrames(rawDeltaUs, fps) : rawDeltaUs;
      const moves = buildMultiItemMoves({
        currentTracks: tracks.value,
        dragStartSnapshot: dragStartSnapshot.value,
        dragOriginTrackId: dragOriginTrackId.value,
        targetTrackId,
        selectedMovableItemIds,
        deltaUs,
      });

      if (moves.length > 0) {
        let isCollision = false;
        if (overlapMode !== 'pseudo' && dragStartSnapshot.value) {
          const movingIds = new Set(moves.map((move) => move.itemId));
          for (const move of moves) {
            const targetTrack = dragStartSnapshot.value.tracks.find((t) => t.id === move.toTrackId);
            const previewItem = dragStartSnapshot.value.tracks
              .flatMap((track) => track.items)
              .find((trackItem) => trackItem.id === move.itemId);
            if (!targetTrack || !previewItem || previewItem.kind !== 'clip') continue;
            const endUs = move.startUs + previewItem.timelineRange.durationUs;
            for (const it of targetTrack.items) {
              if ((movingIds.has(it.id) && !dragIsCopyOverride.value) || it.kind !== 'clip')
                continue;
              const itStart = it.timelineRange.startUs;
              const itEnd = itStart + it.timelineRange.durationUs;
              if (move.startUs < itEnd && itStart < endUs) {
                isCollision = true;
                break;
              }
            }
            if (isCollision) break;
          }
        }

        movePreview.value = moves.map((move) => ({
          itemId: move.itemId,
          trackId: move.toTrackId,
          startUs: move.startUs,
          isCollision,
        }));
        pendingMoveCommit.value = { moves, isCollision };
        draggingTrackId.value = targetTrackId;
      }

      return;
    }

    if (lastDragAppliedCmd.value && dragStartSnapshot.value) {
      timelineStore.timelineDoc = dragStartSnapshot.value;
      timelineStore.duration = selectTimelineDurationUs(dragStartSnapshot.value);
      lastDragAppliedCmd.value = null;
      draggingTrackId.value = dragOriginTrackId.value ?? trackId;
    }

    let isCollision = false;
    if (overlapMode !== 'pseudo' && dragStartSnapshot.value) {
      const targetTrack = dragStartSnapshot.value.tracks.find((t) => t.id === targetTrackId);
      if (targetTrack) {
        const endUs = startUs + dragAnchorDurationUs.value;
        for (const it of targetTrack.items) {
          if (it.id === itemId && !dragIsCopyOverride.value) continue;
          if (it.kind !== 'clip') continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (startUs < itEnd && itStart < endUs) {
            isCollision = true;
            break;
          }
        }
      }
    }

    movePreview.value = [{ itemId, trackId: targetTrackId, startUs, isCollision }];
    pendingMoveCommit.value = {
      moves: [
        {
          fromTrackId: dragOriginTrackId.value ?? trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
        },
      ],
      isCollision,
    };
  }

  function applyTrimDrag(ctx: DragApplyContext) {
    const {
      mode,
      trackId,
      itemId,
      clientX,
      fps,
      zoom,
      enableFrameSnap,
      enableClipSnap,
      snapThresholdPx,
      overlapMode,
    } = ctx;

    const rawDeltaUs = getDragDeltaUs(clientX, zoom);

    const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * TICKS_PER_SECOND);
    const anchorStartUs = Math.max(0, Math.round(dragAnchorStartUs.value));
    const anchorDurationUs = Math.max(0, Math.round(dragAnchorItemDurationUs.value));
    const anchorEndUs = anchorStartUs + anchorDurationUs;

    let minEdgeUs = 0;
    let maxEdgeUs = Number.POSITIVE_INFINITY;

    const doc = dragStartSnapshot.value;
    if (doc) {
      const startTrack = doc.tracks.find((t) => t.id === trackId);
      const startItem = startTrack?.items.find((it) => it.id === itemId);

      if (startTrack && startItem && startItem.kind === 'clip') {
        const isPseudo = overlapMode === 'pseudo';
        let prevClipEnd = 0;
        let nextClipStart = Number.POSITIVE_INFINITY;

        if (!isPseudo) {
          const itemsOnTrack = startTrack.items
            .filter((it) => it.kind === 'clip' && it.id !== itemId && !it.locked)
            .map((it) => ({
              start: it.timelineRange.startUs,
              end: it.timelineRange.startUs + it.timelineRange.durationUs,
            }));

          for (const it of itemsOnTrack) {
            if (it.end <= anchorStartUs && it.end > prevClipEnd) {
              prevClipEnd = it.end;
            }
            if (it.start >= anchorEndUs && it.start < nextClipStart) {
              nextClipStart = it.start;
            }
          }
        }

        const speed =
          typeof startItem.speed === 'number' && Number.isFinite(startItem.speed)
            ? startItem.speed
            : 1;
        const absSpeed = Math.abs(speed);

        const hasFixedSourceDuration =
          (startItem.clipType === 'media' && !startItem.isImage) ||
          startItem.clipType === 'timeline';

        const prevSourceStartUs = Math.max(
          0,
          Math.round(Number(startItem.sourceRange?.startUs ?? 0)),
        );
        const prevSourceDurationUs = Math.max(
          0,
          Math.round(
            Number(startItem.sourceRange?.durationUs ?? startItem.timelineRange?.durationUs ?? 0),
          ),
        );
        const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

        // Furthest source position the clip may consume. Mirrors computeTrimGeometry:
        // material-backed clips are bound to their real source; when the source
        // duration is not resolved yet, fall back to what is already consumed so
        // the clip cannot be extended into material that does not exist.
        const rawSourceDurationUs = Number(startItem.sourceDurationUs);
        const knownSourceEndUs =
          Number.isFinite(rawSourceDurationUs) && rawSourceDurationUs > 0
            ? Math.round(rawSourceDurationUs)
            : prevSourceEndUs;
        if (mode === 'trim_start') {
          // Leftmost the start edge can travel: until the consumed source start
          // reaches 0 (the clip already begins `prevSourceStartUs` into the
          // material). Using `knownSourceEndUs` here ignored an already-trimmed
          // end and let the start drag past where the clip can actually grow.
          const minSourceBound = hasFixedSourceDuration
            ? anchorStartUs - prevSourceStartUs / absSpeed
            : Number.NEGATIVE_INFINITY;

          minEdgeUs = Math.max(prevClipEnd, minSourceBound);
          maxEdgeUs = anchorEndUs;
        } else {
          // Rightmost the end edge can travel: until the consumed source end
          // reaches the material end. Anchored on the clip's real consumed source
          // (`prevSourceStartUs`), so a clip trimmed at the start can't be dragged
          // past the actual end of material.
          const maxSourceBound = hasFixedSourceDuration
            ? anchorStartUs + (knownSourceEndUs - prevSourceStartUs) / absSpeed
            : Number.POSITIVE_INFINITY;

          minEdgeUs = anchorStartUs;
          maxEdgeUs = Math.min(nextClipStart, maxSourceBound);
        }
      }
    }

    const unclampedRawEdgeUs =
      mode === 'trim_start' ? anchorStartUs + rawDeltaUs : anchorEndUs + rawDeltaUs;
    const rawEdgeUs = Math.max(minEdgeUs, Math.min(maxEdgeUs, unclampedRawEdgeUs));
    isTrimEdgeBlocked.value = unclampedRawEdgeUs !== rawEdgeUs;

    let snappedEdgeUs = Math.round(rawEdgeUs);
    let bestDist = thresholdUs;

    if (enableClipSnap) {
      const clipSnap = pickBestSnapCandidateUs({
        rawUs: rawEdgeUs,
        thresholdUs,
        targetsUs: dragSnapTargetsUs.value,
      });
      snappedEdgeUs = clipSnap.snappedUs;
      bestDist = clipSnap.distUs;
    }

    if (enableFrameSnap) {
      const baseUs = bestDist < thresholdUs ? snappedEdgeUs : rawEdgeUs;
      snappedEdgeUs = quantizeStartUsToFrames(baseUs, fps);
    }

    // Re-clamp after snap/frame snap to enforce media boundaries.
    snappedEdgeUs = Math.max(minEdgeUs, Math.min(maxEdgeUs, snappedEdgeUs));

    const desiredDeltaUs =
      mode === 'trim_start' ? snappedEdgeUs - anchorStartUs : snappedEdgeUs - anchorEndUs;
    const desiredQuantizedDeltaUs = enableFrameSnap
      ? quantizeDeltaUsToFrames(desiredDeltaUs, fps)
      : Math.round(desiredDeltaUs);

    lastDragClientX.value = clientX;
    dragLastAppliedQuantizedDeltaUs.value = desiredQuantizedDeltaUs;

    const cmdEdge = mode === 'trim_start' ? 'start' : 'end';

    const nextPreviews: TimelineTrimPreview[] = [];
    for (const preview of trimPreview.value) {
      const pTrack = doc?.tracks.find((t) => t.id === preview.trackId);
      const pItem = pTrack?.items.find((it) => it.id === preview.itemId);
      if (!pItem || pItem.kind !== 'clip') continue;

      const speed =
        typeof pItem.speed === 'number' && Number.isFinite(pItem.speed) ? pItem.speed : 1;
      const hasFixedSourceDuration =
        (pItem.clipType === 'media' && !pItem.isImage) || pItem.clipType === 'timeline';

      const { timelineRange, valid } = computeTrimGeometry({
        edge: cmdEdge,
        deltaUs: desiredQuantizedDeltaUs,
        speed,
        fps,
        quantizeToFrames: enableFrameSnap,
        timelineRange: pItem.timelineRange,
        sourceRange: pItem.sourceRange,
        sourceDurationUs: pItem.sourceDurationUs,
        hasFixedSourceDuration,
      });

      if (!valid) continue;

      nextPreviews.push({
        ...preview,
        startUs: Math.max(0, Math.round(timelineRange.startUs)),
        durationUs: Math.max(0, Math.round(timelineRange.durationUs)),
        deltaUs: desiredQuantizedDeltaUs,
      });
    }

    trimPreview.value = nextPreviews;
    pendingTrimCommit.value = {
      targetTrackId: trackId,
      targetItemId: itemId,
      edge: cmdEdge,
      deltaUs: desiredQuantizedDeltaUs,
      quantizeToFrames: enableFrameSnap,
      commandType: overlapMode === 'pseudo' ? 'overlay_trim_item' : 'trim_item',
    };
  }

  function applyDragFromPendingClientX() {
    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    const clientX = pendingDragClientX.value;
    const clientY = pendingDragClientY.value;

    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    if (!mode || !trackId || !itemId || clientX === null || clientY === null) return;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase);
    const zoom = timelineStore.timelineZoom;
    let enableFrameSnap = true;
    let isAudioOnlyDrag = false;
    if (mode === 'move') {
      const selectedMovableItemIds = getSelectedMovableItemIds({
        selectedItemIds: timelineStore.selectedItemIds,
        tracks: tracks.value,
      });
      const itemsToMove = selectedMovableItemIds.length > 0 ? selectedMovableItemIds : [itemId];
      const hasVideo = tracks.value.some(
        (t) => t.kind === 'video' && t.items.some((item) => itemsToMove.includes(item.id)),
      );
      isAudioOnlyDrag = !hasVideo;
    } else {
      const track = tracks.value.find((t) => t.id === trackId);
      isAudioOnlyDrag = track?.kind === 'audio';
    }
    enableFrameSnap = resolveDragFrameSnap(isAudioOnlyDrag);
    // The free override (clip-snap bypass) is audio-only too: on video/mixed
    // drags it is ignored so nothing but audio can be placed freely.
    const freeOverrideActive = dragIsFreeOverride.value && isAudioOnlyDrag;
    const enableClipSnapBase = !freeOverrideActive && settingsStore.toolbarSnapMode === 'snap';
    const enableClipSnap =
      !freeOverrideActive &&
      (dragToggleSnapOverride.value ? !enableClipSnapBase : enableClipSnapBase);
    const snapThresholdPx = settingsStore.snapThresholdPx;
    const overlapMode = dragUsePseudoOverlapOverride.value ? 'pseudo' : 'none';

    const ctx: DragApplyContext = {
      mode,
      trackId,
      itemId,
      clientX,
      clientY,
      fps,
      zoom,
      enableFrameSnap,
      enableClipSnap,
      snapThresholdPx,
      overlapMode,
      isAudioOnly: isAudioOnlyDrag,
    };

    if (mode === 'slip') {
      applySlipDrag(ctx);
      return;
    }

    if (mode === 'move') {
      applyMoveDrag(ctx);
      return;
    }

    applyTrimDrag(ctx);
  }

  function scheduleDragApply() {
    scheduleUpdate(() => {
      applyDragFromPendingClientX();
    });
  }

  function onGlobalPointerMove(e: PointerEvent): boolean {
    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    if (!mode || !trackId || !itemId) return false;

    if (e.buttons === 0) {
      onGlobalPointerUp(e);
      return true;
    }

    pendingDragClientX.value = e.clientX;
    pendingDragClientY.value = e.clientY;
    lastDragClientX.value = e.clientX;
    lastDragClientY.value = e.clientY;
    applyDragAction(resolveDragAction(e, dragPointerButton.value));

    updateEdgeScroll(e);
    scheduleDragApply();
    return true;
  }

  function onGlobalPointerUp(e?: PointerEvent) {
    stopEdgeScroll();

    if (!draggingMode.value) return;

    if (e) {
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture(e.pointerId);
    }

    const cancel = dragCancelRequested.value;
    dragCancelRequested.value = false;

    clearSession();

    if (!cancel) {
      applyDragFromPendingClientX();
    }

    const shouldCopyDraggedClip =
      !cancel && draggingMode.value === 'move' && dragIsCopyOverride.value;
    let copiedSingleClipPayload: {
      sourceTrackId: string;
      clip: import('~/timeline/types').TimelineClipItem;
      targetTrackId: string;
      targetStartUs: number;
    } | null = null;

    if (shouldCopyDraggedClip) {
      const movedItemId = draggingItemId.value;
      const commit = pendingMoveCommit.value;
      const snapshot = dragStartSnapshot.value;

      if (
        snapshot &&
        movedItemId &&
        commit &&
        commit.moves.length === 1 &&
        // Copy-drag currently supports only a single selected item
        timelineStore.selectedItemIds.length === 1
      ) {
        const move = commit.moves[0]!;
        const track = snapshot.tracks.find((item) => item.id === move.fromTrackId) ?? null;
        const clip =
          track?.items.find((item) => item.kind === 'clip' && item.id === movedItemId) ?? null;
        if (clip && clip.kind === 'clip') {
          copiedSingleClipPayload = {
            sourceTrackId: move.fromTrackId,
            clip: cloneValue(clip),
            targetTrackId: move.toTrackId,
            targetStartUs: move.startUs,
          };
        }
      }
    }

    if (!cancel && draggingMode.value === 'move') {
      const usePseudoOverlap = dragUsePseudoOverlapOverride.value;
      const overlapMode = usePseudoOverlap ? 'pseudo' : 'none';

      const commit = pendingMoveCommit.value;
      if (commit && commit.moves.length > 0 && !commit.isCollision) {
        const hasVideo = commit.moves.some((move) => {
          const track = tracks.value.find((t) => t.id === move.toTrackId);
          return track?.kind === 'video';
        });
        const enableFrameSnap = resolveDragFrameSnap(!hasVideo);

        const docBeforeApply = timelineStore.timelineDoc;
        let appliedCmdLocal: TimelineCommand | null = null;
        if (overlapMode === 'pseudo') {
          const cmds: Extract<TimelineCommand, { type: 'overlay_place_item' }>[] = commit.moves.map(
            (move) => ({
              type: 'overlay_place_item' as const,
              fromTrackId: move.fromTrackId,
              toTrackId: move.toTrackId,
              itemId: move.itemId,
              startUs: move.startUs,
              quantizeToFrames: enableFrameSnap,
              ignoreLinks: usePseudoOverlap,
            }),
          );
          timelineStore.batchApplyTimeline(cmds, {
            saveMode: 'none',
            skipHistory: true,
          });
          appliedCmdLocal = cmds[cmds.length - 1] ?? null;
        } else {
          const cmd: Extract<TimelineCommand, { type: 'move_items' }> = {
            type: 'move_items',
            moves: commit.moves,
            quantizeToFrames: enableFrameSnap,
            ignoreLinks: usePseudoOverlap,
            // Starts are already frame-snapped (single group / per-item) during the
            // drag; apply them verbatim so off-grid clips keep their sub-frame phase.
            preserveItemOffsets: true,
          };
          timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
          appliedCmdLocal = cmd;
        }
        // Only record an applied command if the document actually changed.
        // A click-without-drag (or drag back to original position) leaves the doc
        // identical; recording it would clear the redo stack for no benefit.
        if (timelineStore.timelineDoc !== docBeforeApply) {
          lastDragAppliedCmd.value = appliedCmdLocal;
          hasPendingTimelinePersist.value = true;
        }
      }
    }

    if (!cancel && (draggingMode.value === 'trim_start' || draggingMode.value === 'trim_end')) {
      const commit = pendingTrimCommit.value;
      if (commit && commit.deltaUs !== 0) {
        const docBeforeApply = timelineStore.timelineDoc;

        if (commit.commandType === 'overlay_trim_item') {
          const cmd: Extract<TimelineCommand, { type: 'overlay_trim_item' }> = {
            type: 'overlay_trim_item',
            trackId: commit.targetTrackId,
            itemId: commit.targetItemId,
            edge: commit.edge,
            deltaUs: commit.deltaUs,
            quantizeToFrames: commit.quantizeToFrames,
          };
          timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
          if (timelineStore.timelineDoc !== docBeforeApply) {
            lastDragAppliedCmd.value = cmd;
            hasPendingTimelinePersist.value = true;
          }
        } else {
          const trims = trimPreview.value
            .map((preview) => {
              const found = docBeforeApply ? findClipById(docBeforeApply, preview.itemId) : null;
              if (!found) return null;
              return {
                trackId: preview.trackId,
                itemId: preview.itemId,
                edge: commit.edge,
                deltaUs: commit.deltaUs,
              };
            })
            .filter(
              (
                x,
              ): x is {
                trackId: string;
                itemId: string;
                edge: 'start' | 'end';
                deltaUs: number;
              } => x !== null,
            );

          if (trims.length === 1) {
            const cmd: Extract<TimelineCommand, { type: 'trim_item' }> = {
              type: 'trim_item',
              ...trims[0]!,
              quantizeToFrames: commit.quantizeToFrames,
            };
            timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
            if (timelineStore.timelineDoc !== docBeforeApply) {
              lastDragAppliedCmd.value = cmd;
              hasPendingTimelinePersist.value = true;
            }
          } else if (trims.length > 1) {
            const cmd: Extract<TimelineCommand, { type: 'trim_items' }> = {
              type: 'trim_items',
              trims,
              quantizeToFrames: commit.quantizeToFrames,
            };
            timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
            if (timelineStore.timelineDoc !== docBeforeApply) {
              lastDragAppliedCmd.value = cmd;
              hasPendingTimelinePersist.value = true;
            }
          }
        }
      }
    }

    const snapshot = dragStartSnapshot.value;
    const appliedCmd = lastDragAppliedCmd.value;
    if (!cancel && snapshot && appliedCmd) {
      let labelKey: string;
      if (appliedCmd.type === 'move_items' && appliedCmd.moves) {
        labelKey =
          appliedCmd.moves.length === 1
            ? 'videoEditor.fileManager.history.entries.moveItem'
            : 'videoEditor.fileManager.history.entries.moveItems';
      } else if (appliedCmd.type === 'update_clip_properties') {
        labelKey = getUpdateClipPropertiesLabelKey(appliedCmd.properties ?? {});
      } else if (
        appliedCmd.type === 'trim_item' ||
        appliedCmd.type === 'trim_items' ||
        appliedCmd.type === 'overlay_trim_item'
      ) {
        labelKey = 'videoEditor.fileManager.history.entries.trimClip';
      } else {
        labelKey = getTimelineCommandLabelKey(appliedCmd.type);
      }
      timelineStore.pushTimelineHistory(snapshot, appliedCmd.type, labelKey);
      dragStartSnapshot.value = null;
    }

    if (cancel && snapshot) {
      timelineStore.timelineDoc = snapshot;
      timelineStore.duration = selectTimelineDurationUs(snapshot);
    }

    if (!cancel && shouldCopyDraggedClip && snapshot) {
      const commit = pendingMoveCommit.value;
      const isCollision = commit?.isCollision ?? false;

      if (isCollision) {
        toast.add({
          title: t('fastcat.timeline.cannotCopyClip'),
          color: 'error',
        });
      } else if (copiedSingleClipPayload) {
        timelineStore.timelineDoc = snapshot;
        timelineStore.duration = selectTimelineDurationUs(snapshot);
        const copyClip = copiedSingleClipPayload.clip;
        void timelineStore.pasteClips(
          [{ sourceTrackId: copiedSingleClipPayload.sourceTrackId, clip: copyClip }],
          {
            targetTrackId: copiedSingleClipPayload.targetTrackId,
            insertStartUs: copiedSingleClipPayload.targetStartUs,
            respectToolbarModes: true,
          },
        );
        hasPendingTimelinePersist.value = true;
      }
    }

    const shouldPersistTimeline = !cancel && hasPendingTimelinePersist.value;
    hasPendingTimelinePersist.value = false;

    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    dragOriginTrackId.value = null;
    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    movePreview.value = [];
    pendingMoveCommit.value = null;
    slipPreview.value = null;
    trimPreview.value = [];
    pendingTrimCommit.value = null;

    dragStartSnapshot.value = null;
    lastDragAppliedCmd.value = null;
    dragIsFreeOverride.value = false;
    dragUsePseudoOverlapOverride.value = false;
    dragDisableFrameSnapOverride.value = false;
    dragIsCopyOverride.value = false;
    dragToggleSnapOverride.value = false;
    dragIsMobileTouch.value = false;
    isTrimEdgeBlocked.value = false;

    if (shouldPersistTimeline) {
      void timelineStore.requestTimelineSave({ immediate: true });
    }
  }

  onBeforeUnmount(() => {
    stopEdgeScroll();
    clearSession();
  });

  return {
    draggingMode,
    draggingItemId,
    movePreview,
    slipPreview,
    trimPreview,
    startMoveItem,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    scheduleDragReapply: scheduleDragReapplyFromLastPointerPosition,
  };
}
