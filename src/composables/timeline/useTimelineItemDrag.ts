import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { TimelineTrack, TimelineMoveItemPayload } from '~/timeline/types';
import {
  buildMultiItemMoves,
  computeSnapTargetsUs,
  getSelectedMovableItemIds,
  resolveMoveTargetTrackId,
} from '~/composables/timeline/timelineInteractionUtils';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useHistoryStore } from '~/stores/history.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY } from '~/stores/timeline/history-labels';

import {
  DEFAULT_HOTKEYS,
  type HotkeyCommandId,
  type HotkeyCombo,
} from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';

import { cloneValue } from '~/utils/clone';
import {
  zoomToPxPerSecond,
  pxToDeltaUs,
  quantizeDeltaUsToFrames,
  quantizeStartUsToFrames,
  pickBestSnapCandidateUs,
  computeSnappedStartUs,
} from '~/utils/timeline/geometry';
import { sanitizeFps, getLinkedClipGroupItemIds } from '~/timeline/commands/utils';
import { formatStopFrameTimecode } from '~/utils/stop-frames';
import { useTimelinePointerSession } from '~/composables/timeline/useTimelinePointerSession';
import { selectTimelineDurationUs } from '~/timeline/selectors';

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

export function useTimelineItemDrag(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const historyStore = useHistoryStore();
  const settingsStore = useTimelineSettingsStore();
  const selectionStore = useSelectionStore();
  const workspaceStore = useWorkspaceStore();
  const { bindSession, clearSession, scheduleUpdate } = useTimelinePointerSession();

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
  const dragFrameOffsetUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const dragSnapTargetsUs = ref<number[]>([]);
  const dragAnchorItemDurationUs = ref(0);
  const hasPendingTimelinePersist = ref(false);
  const lastDragClientX = ref(0);
  const lastDragClientY = ref(0);
  const pendingDragClientX = ref<number | null>(null);
  const pendingDragClientY = ref<number | null>(null);

  const movePreview = ref<TimelineMovePreview | null>(null);
  const slipPreview = ref<TimelineSlipPreview | null>(null);
  const pendingMoveCommit = ref<{
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
    isCollision?: boolean;
  } | null>(null);

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  const dragStartSnapshot = ref<import('~/timeline/types').TimelineDocument | null>(null);
  const lastDragAppliedCmd = ref<import('~/timeline/commands').TimelineCommand | null>(null);
  const dragCancelRequested = ref(false);
  const dragIsFreeOverride = ref(false);
  const dragUsePseudoOverlapOverride = ref(false);
  const dragDisableFrameSnapOverride = ref(false);
  const dragIsCopyOverride = ref(false);
  const dragToggleSnapOverride = ref(false);
  const dragPointerButton = ref<0 | 2>(0);
  const dragIsMobileTouch = ref(false);

  function getToolbarSnapAction(): 'snap' | 'no_snap' | 'free_mode' {
    return settingsStore.toolbarSnapMode;
  }

  function getToolbarDragAction(): ToolbarDragMode | 'none' {
    if (!settingsStore.toolbarDragModeEnabled) {
      return 'none';
    }

    return settingsStore.toolbarDragMode;
  }

  function toggleToolbarDragAction(mode: ToolbarDragMode | 'none'): ToolbarDragMode | 'none' {
    if (mode === 'none') {
      return settingsStore.toolbarDragMode;
    }

    return 'none';
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
    let snapAction = getToolbarSnapAction();
    let dragAction = getToolbarDragAction();

    if (action === 'none') {
      action = '';
    }

    if (action === 'toggle_clip_move_mode') {
      dragAction = toggleToolbarDragAction(dragAction);
    } else if (action === 'pseudo_overlap' || action === 'copy' || action === 'slip') {
      dragAction = action;
    } else if (action === 'free_mode' || action === 'no_snap' || action === 'snap') {
      snapAction = action;
      dragAction = 'none';
    }

    dragIsFreeOverride.value = snapAction === 'free_mode' || dragAction === 'copy';
    dragUsePseudoOverlapOverride.value = dragAction === 'pseudo_overlap';
    dragDisableFrameSnapOverride.value = snapAction === 'free_mode' || dragAction === 'copy';
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

    pendingDragClientX.value = lastDragClientX.value;
    pendingDragClientY.value = lastDragClientY.value;
    scheduleDragApply();
  }

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
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

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
    dragAnchorDurationUs.value =
      tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId)
        ?.timelineRange.durationUs ?? 0;
    dragAnchorSourceStartUs.value = item?.kind === 'clip' ? item.sourceRange.startUs : 0;
    dragAnchorSourceDurationUs.value = item?.kind === 'clip' ? item.sourceRange.durationUs : 0;
    dragAnchorItemDurationUs.value = dragAnchorDurationUs.value;
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const q = quantizeStartUsToFrames(startUs, fps);
    dragFrameOffsetUs.value = Math.round(startUs - q);
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const snapSettings = workspaceStore.userSettings.timeline.snapping;
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: itemId,
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
      includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });

    dragStartSnapshot.value = timelineStore.timelineDoc;
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;

    movePreview.value = {
      itemId,
      trackId,
      startUs,
    };
    pendingMoveCommit.value = null;
    slipPreview.value = null;

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
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

    draggingMode.value = input.edge === 'start' ? 'trim_start' : 'trim_end';
    draggingTrackId.value = input.trackId;
    draggingItemId.value = input.itemId;
    dragAnchorClientX.value = e.clientX;
    dragAnchorScrollLeft.value = scrollEl.value?.scrollLeft ?? 0;
    lastDragClientX.value = e.clientX;
    lastDragClientY.value = e.clientY;
    dragPointerButton.value = e.button as 0 | 2;
    applyDragAction(resolveDragAction(e, dragPointerButton.value));

    dragAnchorStartUs.value = input.startUs;
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const currentItem = tracks.value
      .find((t) => t.id === input.trackId)
      ?.items.find((it) => it.id === input.itemId);
    const durationUs = currentItem?.kind === 'clip' ? currentItem.timelineRange.durationUs : 0;
    dragAnchorItemDurationUs.value = Math.max(0, Math.round(Number(durationUs ?? 0)));

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const snapSettings = workspaceStore.userSettings.timeline.snapping;
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: input.itemId,
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
      includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });

    dragStartSnapshot.value = timelineStore.timelineDoc;
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;

    if (e.pointerType !== 'touch') {
      (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    }
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

  function applyDragFromPendingClientX() {
    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    const clientX = pendingDragClientX.value;
    const clientY = pendingDragClientY.value;

    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    if (!mode || !trackId || !itemId || clientX === null || clientY === null) return;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const zoom = timelineStore.timelineZoom;
    const enableFrameSnap =
      settingsStore.frameSnapMode === 'frames' &&
      !dragIsFreeOverride.value &&
      !dragDisableFrameSnapOverride.value;
    const enableClipSnapBase = settingsStore.toolbarSnapMode === 'snap';
    const enableClipSnap = dragToggleSnapOverride.value ? !enableClipSnapBase : enableClipSnapBase;
    const snapThresholdPx = settingsStore.snapThresholdPx;
    const isShiftPressed = dragUsePseudoOverlapOverride.value;
    const overlapMode = isShiftPressed ? 'pseudo' : settingsStore.overlapMode;

    if (mode === 'slip') {
      const track = tracks.value.find((value) => value.id === trackId);
      const item = track?.items.find((value) => value.id === itemId);
      if (!item || item.kind !== 'clip') return;

      const currentScrollLeft = scrollEl.value?.scrollLeft ?? 0;
      const dxPx =
        clientX - dragAnchorClientX.value + (currentScrollLeft - dragAnchorScrollLeft.value);
      const rawDeltaUs = pxToDeltaUs(dxPx, zoom);

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
        timecode: `${deltaUs >= 0 ? '+' : '-'}${formatStopFrameTimecode({ timeUs: Math.abs(deltaUs), fps })}`,
      };

      const cmd = {
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
      } as const;

      timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
      lastDragAppliedCmd.value = cmd as any;
      hasPendingTimelinePersist.value = true;
      return;
    }

    if (mode === 'move') {
      const currentScrollLeft = scrollEl.value?.scrollLeft ?? 0;
      const dxPx =
        clientX - dragAnchorClientX.value + (currentScrollLeft - dragAnchorScrollLeft.value);
      const rawDeltaUs = pxToDeltaUs(dxPx, zoom);
      const rawStartUs = Math.max(0, dragAnchorStartUs.value + rawDeltaUs);

      const selectedMovableItemIds = getSelectedMovableItemIds({
        selectedItemIds: timelineStore.selectedItemIds,
        tracks: tracks.value,
      });

      const startUs = computeSnappedStartUs({
        rawStartUs,
        draggingItemDurationUs: dragAnchorDurationUs.value,
        fps,
        zoom,
        snapThresholdPx,
        snapTargetsUs: dragSnapTargetsUs.value,
        enableFrameSnap,
        enableClipSnap,
        frameOffsetUs: dragFrameOffsetUs.value,
      });

      const targetTrackId = resolveMoveTargetTrackId({
        clientX,
        clientY,
        draggingTrackId: trackId,
        tracks: tracks.value,
      });

      const isMulti = selectedMovableItemIds.includes(itemId) && selectedMovableItemIds.length > 1;

      if (isMulti && dragStartSnapshot.value) {
        // Fallback for multi-item drag — just let it mutate (less common on mobile anyway)
        const deltaUs = startUs - dragAnchorStartUs.value;
        const moves = buildMultiItemMoves({
          currentTracks: tracks.value,
          dragStartSnapshot: dragStartSnapshot.value,
          dragOriginTrackId: dragOriginTrackId.value,
          targetTrackId,
          selectedMovableItemIds,
          deltaUs,
        });

        if (moves.length > 0) {
          if (overlapMode === 'pseudo') {
            const cmds = moves.map((move) => ({
              type: 'overlay_place_item' as const,
              fromTrackId: move.fromTrackId,
              toTrackId: move.toTrackId,
              itemId: move.itemId,
              startUs: move.startUs,
              quantizeToFrames: enableFrameSnap,
              ignoreLinks: isShiftPressed,
            }));

            timelineStore.batchApplyTimeline(cmds as any, {
              saveMode: 'none',
              skipHistory: true,
            });
            lastDragAppliedCmd.value = (cmds[cmds.length - 1] ?? null) as any;
          } else {
            const cmd = {
              type: 'move_items',
              moves,
              quantizeToFrames: enableFrameSnap,
              ignoreLinks: isShiftPressed,
            } as const;

            timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
            lastDragAppliedCmd.value = cmd as any;
          }

          draggingTrackId.value = targetTrackId;
          hasPendingTimelinePersist.value = true;
        }

        return;
      }

      if (lastDragAppliedCmd.value && dragStartSnapshot.value) {
        timelineStore.timelineDoc = dragStartSnapshot.value as any;
        timelineStore.duration = selectTimelineDurationUs(dragStartSnapshot.value as any) as any;
        lastDragAppliedCmd.value = null;
        draggingTrackId.value = dragOriginTrackId.value ?? trackId;
      }

      let isCollision = false;
      if (overlapMode !== 'pseudo' && dragStartSnapshot.value) {
        const targetTrack = dragStartSnapshot.value.tracks.find((t) => t.id === targetTrackId);
        if (targetTrack) {
          const endUs = startUs + dragAnchorDurationUs.value;
          for (const it of targetTrack.items) {
            if (it.id === itemId) continue;
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

      movePreview.value = { itemId, trackId: targetTrackId, startUs, isCollision };
      pendingMoveCommit.value = {
        fromTrackId: dragOriginTrackId.value ?? trackId,
        toTrackId: targetTrackId,
        itemId,
        startUs,
        isCollision,
      };

      return;
    }

    // Trim modes
    const currentScrollLeft = scrollEl.value?.scrollLeft ?? 0;
    const dxPx =
      clientX - dragAnchorClientX.value + (currentScrollLeft - dragAnchorScrollLeft.value);
    const rawDeltaUs = pxToDeltaUs(dxPx, zoom);

    const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);
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
        const maxSourceDurationUs = hasFixedSourceDuration
          ? Math.max(0, Math.round(startItem.sourceDurationUs))
          : Number.POSITIVE_INFINITY;

        const prevSourceStartUs = Math.max(0, Math.round(startItem.sourceRange.startUs));
        const prevSourceDurationUs = Math.max(0, Math.round(startItem.sourceRange.durationUs));
        const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

        if (mode === 'trim_start') {
          const maxLeftExpansionSource =
            speed >= 0 ? prevSourceStartUs : maxSourceDurationUs - prevSourceEndUs;

          const minSourceBound = hasFixedSourceDuration
            ? anchorStartUs - maxLeftExpansionSource / absSpeed
            : Number.NEGATIVE_INFINITY;

          minEdgeUs = Math.max(prevClipEnd, minSourceBound);
          maxEdgeUs = anchorEndUs;
        } else {
          const maxRightExpansionSource =
            speed >= 0 ? maxSourceDurationUs - prevSourceEndUs : prevSourceStartUs;

          const maxSourceBound = hasFixedSourceDuration
            ? anchorEndUs + maxRightExpansionSource / absSpeed
            : Number.POSITIVE_INFINITY;

          minEdgeUs = anchorStartUs;
          maxEdgeUs = Math.min(nextClipStart, maxSourceBound);
        }
      }
    }

    let rawEdgeUs = mode === 'trim_start' ? anchorStartUs + rawDeltaUs : anchorEndUs + rawDeltaUs;
    rawEdgeUs = Math.max(minEdgeUs, Math.min(maxEdgeUs, rawEdgeUs));

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

    const desiredDeltaUs =
      mode === 'trim_start' ? snappedEdgeUs - anchorStartUs : snappedEdgeUs - anchorEndUs;
    const desiredQuantizedDeltaUs = enableFrameSnap
      ? quantizeDeltaUsToFrames(desiredDeltaUs, fps)
      : Math.round(desiredDeltaUs);

    const nextStepDeltaUs = desiredQuantizedDeltaUs - dragLastAppliedQuantizedDeltaUs.value;
    lastDragClientX.value = clientX;
    if (nextStepDeltaUs === 0) return;
    dragLastAppliedQuantizedDeltaUs.value = desiredQuantizedDeltaUs;

    const cmdEdge = mode === 'trim_start' ? 'start' : 'end';
    const cmdType = overlapMode === 'pseudo' ? 'overlay_trim_item' : 'trim_item';

    const cmd = {
      type: cmdType as any,
      trackId,
      itemId,
      edge: cmdEdge,
      deltaUs: nextStepDeltaUs,
      quantizeToFrames: enableFrameSnap,
    } as any;
    timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
    lastDragAppliedCmd.value = cmd as any;
    hasPendingTimelinePersist.value = true;
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

    scheduleDragApply();
    return true;
  }

  function onGlobalPointerUp(e?: PointerEvent) {
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
      clip: any;
      targetTrackId: string;
      targetStartUs: number;
    } | null = null;

    if (shouldCopyDraggedClip) {
      const movedItemId = draggingItemId.value;
      const commit = pendingMoveCommit.value;
      const snapshot = dragStartSnapshot.value;

      if (snapshot && movedItemId && commit && timelineStore.selectedItemIds.length === 1) {
        const track = snapshot.tracks.find((item) => item.id === commit.fromTrackId) ?? null;
        const clip =
          track?.items.find((item) => item.kind === 'clip' && item.id === movedItemId) ?? null;
        if (clip && clip.kind === 'clip') {
          copiedSingleClipPayload = {
            sourceTrackId: commit.fromTrackId,
            clip: cloneValue(clip),
            targetTrackId: commit.toTrackId,
            targetStartUs: commit.startUs,
          };
        }
      }
    }

    if (
      !cancel &&
      draggingMode.value === 'move' &&
      dragIsFreeOverride.value &&
      !dragIsCopyOverride.value
    ) {
      const doc = timelineStore.timelineDoc;
      if (doc) {
        const movedVideoIds: string[] = [];
        const movedPrimaryId = draggingItemId.value;
        const movedPrimaryTrackId = draggingTrackId.value;

        if (movedPrimaryId && movedPrimaryTrackId) {
          const tr = doc.tracks.find((t) => t.id === movedPrimaryTrackId);
          const it = tr?.items.find((x) => x.id === movedPrimaryId);
          if (it && it.kind === 'clip') {
            if (tr?.kind === 'video') {
              movedVideoIds.push(it.id);
            }

            if (
              tr?.kind === 'audio' &&
              Boolean((it as any).linkedVideoClipId) &&
              Boolean((it as any).lockToLinkedVideo)
            ) {
              timelineStore.applyTimeline(
                {
                  type: 'update_clip_properties',
                  trackId: tr.id,
                  itemId: it.id,
                  properties: {
                    linkedVideoClipId: undefined,
                    lockToLinkedVideo: false,
                  },
                } as any,
                { saveMode: 'none', skipHistory: true },
              );
              hasPendingTimelinePersist.value = true;
            }
          }
        }

        if (movedVideoIds.length > 0) {
          const cmds: any[] = [];
          for (const t of doc.tracks) {
            if (t.kind !== 'audio') continue;
            for (const it of t.items) {
              if (it.kind !== 'clip') continue;
              const linked = String((it as any).linkedVideoClipId ?? '');
              if (!linked) continue;
              if (!(it as any).lockToLinkedVideo) continue;
              if (!movedVideoIds.includes(linked)) continue;
              cmds.push({
                type: 'update_clip_properties',
                trackId: t.id,
                itemId: it.id,
                properties: {
                  linkedVideoClipId: undefined,
                  lockToLinkedVideo: false,
                },
              });
            }
          }

          if (cmds.length > 0) {
            timelineStore.batchApplyTimeline(cmds as any, {
              saveMode: 'none',
              skipHistory: true,
            });
            hasPendingTimelinePersist.value = true;
          }
        }
      }
    }

    if (!cancel && draggingMode.value === 'move') {
      const usePseudoOverlap = dragUsePseudoOverlapOverride.value;
      const overlapMode = usePseudoOverlap ? 'pseudo' : settingsStore.overlapMode;

      const commit = pendingMoveCommit.value;
      if (commit && !commit.isCollision) {
        const enableFrameSnap =
          settingsStore.frameSnapMode === 'frames' &&
          !dragIsFreeOverride.value &&
          !dragDisableFrameSnapOverride.value;

        if (overlapMode === 'pseudo') {
          const cmd = {
            type: 'overlay_place_item',
            fromTrackId: commit.fromTrackId,
            toTrackId: commit.toTrackId,
            itemId: commit.itemId,
            startUs: commit.startUs,
            quantizeToFrames: enableFrameSnap,
            ignoreLinks: usePseudoOverlap,
          } as const;
          timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
          lastDragAppliedCmd.value = cmd as any;
        } else {
          const cmd = {
            type: 'move_item_to_track',
            fromTrackId: commit.fromTrackId,
            toTrackId: commit.toTrackId,
            itemId: commit.itemId,
            startUs: commit.startUs,
            quantizeToFrames: enableFrameSnap,
            ignoreLinks: usePseudoOverlap,
          } as const;
          timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
          lastDragAppliedCmd.value = cmd as any;
        }
        hasPendingTimelinePersist.value = true;
      }
    }

    const snapshot = cloneValue(dragStartSnapshot.value);
    const appliedCmd = lastDragAppliedCmd.value;
    if (!cancel && snapshot && appliedCmd) {
      historyStore.push('timeline', appliedCmd.type, snapshot, TIMELINE_MULTIPLE_ACTIONS_LABEL_KEY);
      dragStartSnapshot.value = null;
    }

    if (cancel && snapshot) {
      timelineStore.timelineDoc = snapshot as any;
      timelineStore.duration = selectTimelineDurationUs(snapshot as any) as any;
    }

    if (!cancel && shouldCopyDraggedClip && snapshot && copiedSingleClipPayload) {
      timelineStore.timelineDoc = snapshot as any;
      timelineStore.duration = selectTimelineDurationUs(snapshot as any) as any;
      const copyClip = copiedSingleClipPayload.clip;
      timelineStore.pasteClips(
        [{ sourceTrackId: copiedSingleClipPayload.sourceTrackId, clip: copyClip }],
        {
          targetTrackId: copiedSingleClipPayload.targetTrackId,
          insertStartUs: copiedSingleClipPayload.targetStartUs,
        },
      );
      hasPendingTimelinePersist.value = true;
    }

    if (!cancel && hasPendingTimelinePersist.value) {
      void timelineStore.requestTimelineSave({ immediate: true });
      hasPendingTimelinePersist.value = false;
    }

    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    dragOriginTrackId.value = null;
    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    movePreview.value = null;
    pendingMoveCommit.value = null;
    slipPreview.value = null;

    dragStartSnapshot.value = null;
    lastDragAppliedCmd.value = null;
    dragIsFreeOverride.value = false;
    dragUsePseudoOverlapOverride.value = false;
    dragDisableFrameSnapOverride.value = false;
    dragIsCopyOverride.value = false;
    dragToggleSnapOverride.value = false;
    dragIsMobileTouch.value = false;
  }

  onBeforeUnmount(() => {
    clearSession();
  });

  return {
    draggingMode,
    draggingItemId,
    movePreview,
    slipPreview,
    startMoveItem,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    scheduleDragReapply: scheduleDragReapplyFromLastPointerPosition,
  };
}
