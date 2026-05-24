import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, ref } from 'vue';

import type { TimelineTrack, TimelineMoveItemPayload, TimelineDocument } from '~/timeline/types';
import {
  buildMultiItemMoves,
  computeSnapTargetsUs,
  getSelectedMovableItemIds,
  resolveMoveTargetTrackId,
} from '~/composables/timeline/timelineInteractionUtils';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import {
  getTimelineCommandLabelKey,
  getUpdateClipPropertiesLabelKey,
} from '~/stores/timeline/history-labels';

import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
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
import type { TimelineCommand } from '~/timeline/commands';
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

  const movePreview = ref<TimelineMovePreview[]>([]);
  const slipPreview = ref<TimelineSlipPreview | null>(null);
  const trimPreview = ref<TimelineTrimPreview | null>(null);
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
    trackId: string;
    itemId: string;
    edge: 'start' | 'end';
    deltaUs: number;
    quantizeToFrames: boolean;
    commandType: 'trim_item' | 'overlay_trim_item';
  } | null>(null);

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

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

  function getToolbarSnapAction(): 'snap' | 'no_snap' | 'free_mode' {
    return settingsStore.toolbarSnapMode;
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
    let snapAction = getToolbarSnapAction();
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

    dragStartSnapshot.value = cloneValue(timelineStore.timelineDoc);
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;

    movePreview.value = [{ itemId, trackId, startUs }];
    pendingMoveCommit.value = null;
    slipPreview.value = null;
    trimPreview.value = null;
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
      excludeItemIds: [input.itemId],
      includeTimelineStart: snapSettings.timelineEdges,
      includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
      includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
      includeMarkers: snapSettings.markers,
      markers: timelineStore.getMarkers(),
      includeClips: snapSettings.clips,
      selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
    });

    dragStartSnapshot.value = cloneValue(timelineStore.timelineDoc);
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;
    movePreview.value = [];
    pendingMoveCommit.value = null;
    slipPreview.value = null;
    trimPreview.value =
      currentItem?.kind === 'clip'
        ? {
            itemId: input.itemId,
            trackId: input.trackId,
            startUs: currentItem.timelineRange.startUs,
            durationUs: currentItem.timelineRange.durationUs,
            edge: input.edge,
            deltaUs: 0,
          }
        : null;
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
    const overlapMode = dragUsePseudoOverlapOverride.value ? 'pseudo' : 'none';

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
        timecode: `${deltaUs >= 0 ? '+' : '-'}${formatStopFrameTimecode({
          timeUs: Math.abs(deltaUs),
          fps,
          frameDigits: 1,
        })}`,
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

      timelineStore.applyTimeline(cmd as unknown as import('~/timeline/commands').TimelineCommand, {
        saveMode: 'none',
        skipHistory: true,
      });
      lastDragAppliedCmd.value = cmd as unknown as import('~/timeline/commands').TimelineCommand;
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
          let isCollision = false;
          if (overlapMode !== 'pseudo' && dragStartSnapshot.value) {
            const movingIds = new Set(moves.map((move) => move.itemId));
            for (const move of moves) {
              const targetTrack = dragStartSnapshot.value.tracks.find(
                (t) => t.id === move.toTrackId,
              );
              const previewItem = dragStartSnapshot.value.tracks
                .flatMap((track) => track.items)
                .find((trackItem) => trackItem.id === move.itemId);
              if (!targetTrack || !previewItem || previewItem.kind !== 'clip') continue;
              const endUs = move.startUs + previewItem.timelineRange.durationUs;
              for (const it of targetTrack.items) {
                if (movingIds.has(it.id) || it.kind !== 'clip') continue;
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
        timelineStore.timelineDoc =
          dragStartSnapshot.value as import('~/timeline/types').TimelineDocument;
        timelineStore.duration = selectTimelineDurationUs(
          dragStartSnapshot.value as import('~/timeline/types').TimelineDocument,
        );
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
          const minSourceBound = hasFixedSourceDuration
            ? anchorEndUs - knownSourceEndUs / absSpeed
            : Number.NEGATIVE_INFINITY;

          minEdgeUs = Math.max(prevClipEnd, minSourceBound);
          maxEdgeUs = anchorEndUs;
        } else {
          const maxSourceBound = hasFixedSourceDuration
            ? anchorStartUs + knownSourceEndUs / absSpeed
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

    // Re-clamp after snap/frame snap to enforce media boundaries
    snappedEdgeUs = Math.max(minEdgeUs, Math.min(maxEdgeUs, snappedEdgeUs));

    const desiredDeltaUs =
      mode === 'trim_start' ? snappedEdgeUs - anchorStartUs : snappedEdgeUs - anchorEndUs;
    const desiredQuantizedDeltaUs = enableFrameSnap
      ? quantizeDeltaUsToFrames(desiredDeltaUs, fps)
      : Math.round(desiredDeltaUs);

    lastDragClientX.value = clientX;
    dragLastAppliedQuantizedDeltaUs.value = desiredQuantizedDeltaUs;

    const nextStartUs =
      mode === 'trim_start' ? anchorStartUs + desiredQuantizedDeltaUs : anchorStartUs;
    const nextDurationUs =
      mode === 'trim_start'
        ? anchorDurationUs - desiredQuantizedDeltaUs
        : anchorDurationUs + desiredQuantizedDeltaUs;
    const cmdEdge = mode === 'trim_start' ? 'start' : 'end';

    trimPreview.value = {
      itemId,
      trackId,
      startUs: Math.max(0, Math.round(nextStartUs)),
      durationUs: Math.max(0, Math.round(nextDurationUs)),
      edge: cmdEdge,
      deltaUs: desiredQuantizedDeltaUs,
    };
    pendingTrimCommit.value = {
      trackId,
      itemId,
      edge: cmdEdge,
      deltaUs: desiredQuantizedDeltaUs,
      quantizeToFrames: enableFrameSnap,
      commandType: overlapMode === 'pseudo' ? 'overlay_trim_item' : 'trim_item',
    };
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

    if (
      !cancel &&
      draggingMode.value === 'move' &&
      dragIsFreeOverride.value &&
      !dragIsCopyOverride.value &&
      pendingMoveCommit.value &&
      !pendingMoveCommit.value.isCollision
    ) {
      // Unlinks must run only when the move itself will succeed. Otherwise the
      // skipHistory unlink writes survive without a corresponding history entry
      // (the entry is only pushed when a move actually commits below), leaving
      // them irreversible by undo.
      const doc = timelineStore.timelineDoc;
      if (doc) {
        const movedVideoIds: string[] = [];
        const moves = pendingMoveCommit.value?.moves ?? [];

        for (const move of moves) {
          const tr = doc.tracks.find((t) => t.id === move.toTrackId);
          const it = tr?.items.find((x) => x.id === move.itemId);
          if (!it || it.kind !== 'clip') continue;

          if (tr?.kind === 'video') {
            movedVideoIds.push(it.id);
          }

          if (
            tr?.kind === 'audio' &&
            Boolean(it.linkedVideoClipId) &&
            Boolean(it.lockToLinkedVideo)
          ) {
            timelineStore.applyTimeline(
              {
                type: 'unlink_audio_from_video',
                audioTrackId: tr.id,
                audioItemId: it.id,
              },
              { saveMode: 'none', skipHistory: true },
            );
            hasPendingTimelinePersist.value = true;
          }
        }

        if (movedVideoIds.length > 0) {
          const cmds: import('~/timeline/commands').TimelineCommand[] = [];
          for (const t of doc.tracks) {
            if (t.kind !== 'audio') continue;
            for (const it of t.items) {
              if (it.kind !== 'clip') continue;
              const linked = it.linkedVideoClipId ?? '';
              if (!linked) continue;
              if (!it.lockToLinkedVideo) continue;
              if (!movedVideoIds.includes(linked)) continue;
              cmds.push({
                type: 'unlink_audio_from_video',
                audioTrackId: t.id,
                audioItemId: it.id,
              });
            }
          }

          if (cmds.length > 0) {
            timelineStore.batchApplyTimeline(cmds, {
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
      const overlapMode = usePseudoOverlap ? 'pseudo' : 'none';

      const commit = pendingMoveCommit.value;
      if (commit && commit.moves.length > 0 && !commit.isCollision) {
        const enableFrameSnap =
          settingsStore.frameSnapMode === 'frames' &&
          !dragIsFreeOverride.value &&
          !dragDisableFrameSnapOverride.value;

        const docBeforeApply = timelineStore.timelineDoc;
        let appliedCmdLocal: import('~/timeline/commands').TimelineCommand | null = null;
        if (overlapMode === 'pseudo') {
          const cmds = commit.moves.map((move) => ({
            type: 'overlay_place_item' as const,
            fromTrackId: move.fromTrackId,
            toTrackId: move.toTrackId,
            itemId: move.itemId,
            startUs: move.startUs,
            quantizeToFrames: enableFrameSnap,
            ignoreLinks: usePseudoOverlap,
          }));
          timelineStore.batchApplyTimeline(
            cmds as unknown as import('~/timeline/commands').TimelineCommand[],
            {
              saveMode: 'none',
              skipHistory: true,
            },
          );
          appliedCmdLocal = (cmds[cmds.length - 1] ??
            null) as unknown as import('~/timeline/commands').TimelineCommand;
        } else {
          const cmd = {
            type: 'move_items',
            moves: commit.moves,
            quantizeToFrames: enableFrameSnap,
            ignoreLinks: usePseudoOverlap,
          } as const;
          timelineStore.applyTimeline(
            cmd as unknown as import('~/timeline/commands').TimelineCommand,
            { saveMode: 'none', skipHistory: true },
          );
          appliedCmdLocal = cmd as unknown as import('~/timeline/commands').TimelineCommand;
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
        const cmd = {
          type: commit.commandType as string,
          trackId: commit.trackId,
          itemId: commit.itemId,
          edge: commit.edge,
          deltaUs: commit.deltaUs,
          quantizeToFrames: commit.quantizeToFrames,
        } as const;
        const docBeforeApply = timelineStore.timelineDoc;
        timelineStore.applyTimeline(
          cmd as unknown as import('~/timeline/commands').TimelineCommand,
          { saveMode: 'none', skipHistory: true },
        );
        if (timelineStore.timelineDoc !== docBeforeApply) {
          lastDragAppliedCmd.value =
            cmd as unknown as import('~/timeline/commands').TimelineCommand;
          hasPendingTimelinePersist.value = true;
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
      } else if (appliedCmd.type === 'trim_item' || appliedCmd.type === 'overlay_trim_item') {
        labelKey = 'videoEditor.fileManager.history.entries.trimClip';
      } else {
        labelKey = getTimelineCommandLabelKey(appliedCmd.type);
      }
      timelineStore.pushTimelineHistory(snapshot, appliedCmd.type, labelKey);
      dragStartSnapshot.value = null;
    }

    if (cancel && snapshot) {
      timelineStore.timelineDoc = snapshot as import('~/timeline/types').TimelineDocument;
      timelineStore.duration = selectTimelineDurationUs(
        snapshot as import('~/timeline/types').TimelineDocument,
      );
    }

    if (!cancel && shouldCopyDraggedClip && snapshot && copiedSingleClipPayload) {
      timelineStore.timelineDoc = snapshot as import('~/timeline/types').TimelineDocument;
      timelineStore.duration = selectTimelineDurationUs(
        snapshot as import('~/timeline/types').TimelineDocument,
      );
      const copyClip = copiedSingleClipPayload.clip;
      void timelineStore.pasteClips(
        [{ sourceTrackId: copiedSingleClipPayload.sourceTrackId, clip: copyClip }],
        {
          targetTrackId: copiedSingleClipPayload.targetTrackId,
          insertStartUs: copiedSingleClipPayload.targetStartUs,
        },
      );
      hasPendingTimelinePersist.value = true;
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
    trimPreview.value = null;
    pendingTrimCommit.value = null;

    dragStartSnapshot.value = null;
    lastDragAppliedCmd.value = null;
    dragIsFreeOverride.value = false;
    dragUsePseudoOverlapOverride.value = false;
    dragDisableFrameSnapOverride.value = false;
    dragIsCopyOverride.value = false;
    dragToggleSnapOverride.value = false;
    dragIsMobileTouch.value = false;

    if (shouldPersistTimeline) {
      void timelineStore.requestTimelineSave({ immediate: true });
    }
  }

  onBeforeUnmount(() => {
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
