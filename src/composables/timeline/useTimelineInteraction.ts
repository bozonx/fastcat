import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useHistoryStore } from '~/stores/history.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineMarker } from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import {
  BASE_PX_PER_SECOND,
  zoomToPxPerSecond,
  timeUsToPx,
  pxToTimeUs,
  pxToDeltaUs,
  computeAnchoredScrollLeft,
  quantizeDeltaUsToFrames,
  quantizeStartUsToFrames,
  sanitizeSnapTargetsUs,
  pickBestSnapCandidateUs,
  computeSnappedStartUs,
} from '~/utils/timeline/geometry';
import { sanitizeFps, getLinkedClipGroupItemIds } from '~/timeline/commands/utils';

export { BASE_PX_PER_SECOND, timeUsToPx, pxToTimeUs, pxToDeltaUs, computeAnchoredScrollLeft };

function computeSnapTargetsUs(params: {
  tracks: TimelineTrack[];
  excludeItemId: string;
  includeTimelineStart: boolean;
  includeTimelineEndUs: number | null;
  includePlayheadUs: number | null;
  includeMarkers: boolean;
  markers: TimelineMarker[];
}): number[] {
  const targets: number[] = [];
  if (params.includeTimelineStart) targets.push(0);
  if (
    typeof params.includeTimelineEndUs === 'number' &&
    Number.isFinite(params.includeTimelineEndUs)
  ) {
    targets.push(params.includeTimelineEndUs);
  }
  if (typeof params.includePlayheadUs === 'number' && Number.isFinite(params.includePlayheadUs)) {
    targets.push(params.includePlayheadUs);
  }

  if (params.includeMarkers) {
    for (const m of params.markers) {
      if (!Number.isFinite(m.timeUs)) continue;
      targets.push(m.timeUs);
      if (typeof m.durationUs === 'number' && Number.isFinite(m.durationUs)) {
        targets.push(m.timeUs + m.durationUs);
      }
    }
  }

  for (const track of params.tracks) {
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === params.excludeItemId) continue;
      targets.push(it.timelineRange.startUs);
      targets.push(it.timelineRange.startUs + it.timelineRange.durationUs);
    }
  }

  return sanitizeSnapTargetsUs(targets);
}

export interface TimelineMovePreview {
  itemId: string;
  trackId: string;
  startUs: number;
}

export function useTimelineInteraction(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const historyStore = useHistoryStore();
  const settingsStore = useTimelineSettingsStore();

  const isDraggingPlayhead = ref(false);
  const draggingItemId = ref<string | null>(null);
  const draggingTrackId = ref<string | null>(null);
  const dragOriginTrackId = ref<string | null>(null);
  const draggingMode = ref<'move' | 'trim_start' | 'trim_end' | null>(null);
  const dragAnchorClientX = ref(0);
  const dragAnchorStartUs = ref(0);
  const dragAnchorDurationUs = ref(0);
  const dragFrameOffsetUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const dragSnapTargetsUs = ref<number[]>([]);
  const dragAnchorItemDurationUs = ref(0);
  const hasPendingTimelinePersist = ref(false);
  const lastDragClientX = ref(0);
  const pendingDragClientX = ref<number | null>(null);
  const pendingDragClientY = ref<number | null>(null);

  const movePreview = ref<TimelineMovePreview | null>(null);
  const pendingMoveCommit = ref<{
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  } | null>(null);

  const dragStartSnapshot = ref<import('~/timeline/types').TimelineDocument | null>(null);
  const lastDragAppliedCmd = ref<import('~/timeline/commands').TimelineCommand | null>(null);
  const dragCancelRequested = ref(false);
  const dragIsFreeOverride = ref(false);

  let dragRafId: number | null = null;

  function getLocalX(e: MouseEvent): number {
    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    if (!rect) return 0;
    return e.clientX - rect.left + scrollX;
  }

  function seekByMouseEvent(e: MouseEvent) {
    const x = getLocalX(e);
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
  }

  function onTimeRulerPointerDown(e: PointerEvent) {
    seekByMouseEvent(e);
    startPlayheadDrag(e);
  }

  function startPlayheadDrag(e: PointerEvent) {
    isDraggingPlayhead.value = true;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function selectItem(e: PointerEvent, itemId: string) {
    const isMulti = e.shiftKey || e.metaKey || e.ctrlKey;

    const doc = timelineStore.timelineDoc;
    const groupedIds = doc ? getLinkedClipGroupItemIds(doc, itemId) : [itemId];

    if (isMulti) {
      const nextSelectedIds = new Set(timelineStore.selectedItemIds);
      const allGroupedSelected = groupedIds.every((id) => nextSelectedIds.has(id));
      if (allGroupedSelected) {
        for (const id of groupedIds) nextSelectedIds.delete(id);
      } else {
        for (const id of groupedIds) nextSelectedIds.add(id);
      }
      timelineStore.selectTimelineItems([...nextSelectedIds]);
    } else {
      timelineStore.selectTimelineItems(groupedIds);
    }

    const selectedIds = timelineStore.selectedItemIds;
    const items = tracks.value
      .flatMap((t) => t.items.map((it) => ({ trackId: t.id, item: it })))
      .filter((x) => selectedIds.includes(x.item.id))
      .map((x) => ({ trackId: x.trackId, itemId: x.item.id }));

    const selectionStore = useSelectionStore();
    selectionStore.selectTimelineItems(items);
  }

  function startMoveItem(e: PointerEvent, trackId: string, itemId: string, startUs: number) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const item = tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId);
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

    // If the item being dragged is already part of the selection, don't clear the other selected items.
    // If it's not part of the selection, we should only select this item.
    if (!timelineStore.selectedItemIds.includes(itemId)) {
      const doc = timelineStore.timelineDoc;
      const groupedIds = doc ? getLinkedClipGroupItemIds(doc, itemId) : [itemId];
      timelineStore.selectTimelineItems(groupedIds);

      const selectionStore = useSelectionStore();
      const groupedItems = tracks.value
        .flatMap((t) => t.items.map((it) => ({ trackId: t.id, item: it })))
        .filter((x) => groupedIds.includes(x.item.id))
        .map((x) => ({ trackId: x.trackId, itemId: x.item.id }));
      selectionStore.selectTimelineItems(groupedItems);
    }

    draggingMode.value = 'move';
    draggingTrackId.value = trackId;
    dragOriginTrackId.value = trackId;
    draggingItemId.value = itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragIsFreeOverride.value = e.shiftKey;
    dragAnchorStartUs.value = startUs;
    dragAnchorDurationUs.value =
      tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId)
        ?.timelineRange.durationUs ?? 0;
    dragAnchorItemDurationUs.value = dragAnchorDurationUs.value;
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const q = quantizeStartUsToFrames(startUs, fps);
    dragFrameOffsetUs.value = Math.round(startUs - q);
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: itemId,
      includeTimelineStart: true,
      includeTimelineEndUs: timelineEndUs,
      includePlayheadUs: timelineStore.currentTime,
      includeMarkers: true,
      markers: timelineStore.getMarkers(),
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

    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function startTrimItem(
    e: PointerEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const item = tracks.value
      .find((t) => t.id === input.trackId)
      ?.items.find((it) => it.id === input.itemId);
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

    draggingMode.value = input.edge === 'start' ? 'trim_start' : 'trim_end';
    draggingTrackId.value = input.trackId;
    draggingItemId.value = input.itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragIsFreeOverride.value = e.shiftKey;
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
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: input.itemId,
      includeTimelineStart: true,
      includeTimelineEndUs: timelineEndUs,
      includePlayheadUs: timelineStore.currentTime,
      includeMarkers: true,
      markers: timelineStore.getMarkers(),
    });

    dragCancelRequested.value = false;

    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;

    const hasActiveDrag = Boolean(draggingMode.value) || isDraggingPlayhead.value;
    if (!hasActiveDrag) return;

    dragCancelRequested.value = true;
    e.preventDefault();
    onGlobalPointerUp();
  }

  function applyDragFromPendingClientX() {
    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    const clientX = pendingDragClientX.value;
    const clientY = pendingDragClientY.value;

    pendingDragClientX.value = null;
    pendingDragClientY.value = null;
    dragRafId = null;

    if (!mode || !trackId || !itemId || clientX === null || clientY === null) return;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const zoom = timelineStore.timelineZoom;
    const enableFrameSnap = settingsStore.frameSnapMode === 'frames' && !dragIsFreeOverride.value;
    const enableClipSnap = settingsStore.clipSnapMode === 'clips';
    const snapThresholdPx = settingsStore.snapThresholdPx;
    const isShiftPressed = dragIsFreeOverride.value;
    const overlapMode = isShiftPressed ? 'pseudo' : settingsStore.overlapMode;

    if (mode === 'move') {
      const dxPx = clientX - dragAnchorClientX.value;
      const rawDeltaUs = pxToDeltaUs(dxPx, zoom);
      const rawStartUs = Math.max(0, dragAnchorStartUs.value + rawDeltaUs);

      const selectedMovableItemIds = timelineStore.selectedItemIds.filter((selectedId) => {
        const selectedItem = tracks.value
          .find((track) => track.items.some((trackItem) => trackItem.id === selectedId))
          ?.items.find((trackItem) => trackItem.id === selectedId);
        return selectedItem?.kind === 'clip' && !selectedItem.locked;
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

      const trackEl = document.elementFromPoint(clientX, clientY)?.closest('[data-track-id]');
      const hoverTrackId = trackEl?.getAttribute('data-track-id');
      let targetTrackId = trackId;

      if (hoverTrackId && hoverTrackId !== trackId) {
        const fromTrack = tracks.value.find((t) => t.id === trackId);
        const toTrack = tracks.value.find((t) => t.id === hoverTrackId);
        if (fromTrack && toTrack && fromTrack.kind === toTrack.kind) {
          targetTrackId = hoverTrackId;
        }
      }

      const isMulti = selectedMovableItemIds.includes(itemId) && selectedMovableItemIds.length > 1;

      if (isMulti && dragStartSnapshot.value) {
        const deltaUs = startUs - dragAnchorStartUs.value;

        const moves: { fromTrackId: string; toTrackId: string; itemId: string; startUs: number }[] =
          [];

        let trackOffset = 0;

        if (targetTrackId !== dragOriginTrackId.value) {
          const origIdx = tracks.value.findIndex((t) => t.id === dragOriginTrackId.value);

          const newIdx = tracks.value.findIndex((t) => t.id === targetTrackId);

          if (origIdx !== -1 && newIdx !== -1) {
            trackOffset = newIdx - origIdx;
          }
        }

        for (const selectedId of selectedMovableItemIds) {
          let origTrackId = '';

          let origStartUs = 0;

          for (const t of dragStartSnapshot.value.tracks) {
            const it = t.items.find((x) => x.id === selectedId);

            if (it && it.kind === 'clip') {
              origTrackId = t.id;

              origStartUs = it.timelineRange.startUs;

              break;
            }
          }

          let currTrackId = '';

          for (const t of tracks.value) {
            if (t.items.some((x) => x.id === selectedId)) {
              currTrackId = t.id;

              break;
            }
          }

          if (origTrackId && currTrackId) {
            let toTrackId = origTrackId;

            if (trackOffset !== 0) {
              const origIdx = tracks.value.findIndex((t) => t.id === origTrackId);

              const newIdx = origIdx + trackOffset;

              if (newIdx >= 0 && newIdx < tracks.value.length) {
                const targetT = tracks.value[newIdx];

                const origT = tracks.value[origIdx];

                if (targetT && origT && targetT.kind === origT.kind) {
                  toTrackId = targetT.id;
                }
              }
            }

            moves.push({
              fromTrackId: currTrackId,

              toTrackId,

              itemId: selectedId,

              startUs: Math.max(0, origStartUs + deltaUs),
            });
          }
        }

        moves.sort((a, b) => {
          return deltaUs >= 0 ? b.startUs - a.startUs : a.startUs - b.startUs;
        });

        if (moves.length > 0) {
          try {
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
          } catch {}
        }

        return;
      }

      if (overlapMode === 'pseudo') {
        movePreview.value = { itemId, trackId: targetTrackId, startUs };
        pendingMoveCommit.value = {
          fromTrackId: dragOriginTrackId.value ?? trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
        };
        draggingTrackId.value = targetTrackId;
        return;
      }

      try {
        const cmd = {
          type: 'move_item_to_track',
          fromTrackId: trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
          quantizeToFrames: enableFrameSnap,
          ignoreLinks: isShiftPressed,
        } as const;
        timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
        lastDragAppliedCmd.value = cmd as any;
        draggingTrackId.value = targetTrackId;
        hasPendingTimelinePersist.value = true;
      } catch {}
      return;
    }

    // Trim modes
    const dxPx = clientX - dragAnchorClientX.value;
    const rawDeltaUs = pxToDeltaUs(dxPx, zoom);

    const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);
    const anchorStartUs = Math.max(0, Math.round(dragAnchorStartUs.value));
    const anchorDurationUs = Math.max(0, Math.round(dragAnchorItemDurationUs.value));
    const anchorEndUs = anchorStartUs + anchorDurationUs;

    const rawEdgeUs = mode === 'trim_start' ? anchorStartUs + rawDeltaUs : anchorEndUs + rawDeltaUs;

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

    // Convert snapped edge back to delta relative to current edge (so we stay compatible with timeline commands)
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

    try {
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
    } catch {
      // Keep last applied quantized delta unchanged on failure? We intentionally keep it,
      // so the user can continue dragging and we only apply deltas when possible.
    }
  }

  function scheduleDragApply() {
    if (dragRafId !== null) return;
    dragRafId = requestAnimationFrame(() => {
      applyDragFromPendingClientX();
    });
  }

  function onGlobalPointerMove(e: PointerEvent) {
    if (isDraggingPlayhead.value) {
      if (e.buttons === 0) {
        onGlobalPointerUp(e);
        return;
      }
      const scrollerRect = scrollEl.value?.getBoundingClientRect();
      if (!scrollerRect) return;
      const scrollX = scrollEl.value?.scrollLeft ?? 0;
      const x = e.clientX - scrollerRect.left + scrollX;
      timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
      return;
    }

    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    if (!mode || !trackId || !itemId) return;

    if (e.buttons === 0) {
      onGlobalPointerUp(e);
      return;
    }

    pendingDragClientX.value = e.clientX;
    pendingDragClientY.value = e.clientY;
    dragIsFreeOverride.value = e.shiftKey;
    scheduleDragApply();
  }

  function onGlobalPointerUp(e?: PointerEvent) {
    if (e) {
      try {
        (e.currentTarget as HTMLElement | null)?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const cancel = dragCancelRequested.value;
    dragCancelRequested.value = false;

    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }

    if (!cancel) {
      applyDragFromPendingClientX();
    }

    if (!cancel && draggingMode.value === 'move' && dragIsFreeOverride.value) {
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
              try {
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
                  {
                    saveMode: 'none',
                    skipHistory: true,
                  },
                );
                hasPendingTimelinePersist.value = true;
              } catch {}
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
              if (!Boolean((it as any).lockToLinkedVideo)) continue;
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
            try {
              timelineStore.batchApplyTimeline(cmds as any, {
                saveMode: 'none',
                skipHistory: true,
              });
              hasPendingTimelinePersist.value = true;
            } catch {}
          }
        }
      }
    }

    if (!cancel && draggingMode.value === 'move') {
      const isShiftPressed = dragIsFreeOverride.value;
      const overlapMode = isShiftPressed ? 'pseudo' : settingsStore.overlapMode;

      if (overlapMode === 'pseudo') {
        const commit = pendingMoveCommit.value;
        if (commit) {
          try {
            const enableFrameSnap =
              settingsStore.frameSnapMode === 'frames' && !dragIsFreeOverride.value;
            const cmd = {
              type: 'overlay_place_item',
              fromTrackId: commit.fromTrackId,
              toTrackId: commit.toTrackId,
              itemId: commit.itemId,
              startUs: commit.startUs,
              quantizeToFrames: enableFrameSnap,
              ignoreLinks: isShiftPressed,
            } as const;
            timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
            lastDragAppliedCmd.value = cmd as any;
            hasPendingTimelinePersist.value = true;
          } catch {}
        }
      }
    }

    const snapshot = dragStartSnapshot.value;
    const appliedCmd = lastDragAppliedCmd.value;
    const currDoc = timelineStore.timelineDoc;
    if (!cancel && snapshot && appliedCmd && currDoc && snapshot !== currDoc) {
      historyStore.push(appliedCmd as any, snapshot as any);
    }

    if (cancel && snapshot) {
      timelineStore.timelineDoc = snapshot as any;
      timelineStore.duration = selectTimelineDurationUs(snapshot as any) as any;
    }

    if (!cancel && hasPendingTimelinePersist.value) {
      void timelineStore.requestTimelineSave({ immediate: true });
      hasPendingTimelinePersist.value = false;
    }

    isDraggingPlayhead.value = false;
    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    dragOriginTrackId.value = null;
    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    movePreview.value = null;
    pendingMoveCommit.value = null;

    dragStartSnapshot.value = null;
    lastDragAppliedCmd.value = null;
    dragIsFreeOverride.value = false;

    window.removeEventListener('keydown', onGlobalKeyDown);
  }

  onMounted(() => {});

  onBeforeUnmount(() => {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    draggingMode,
    draggingItemId,
    movePreview,
    onTimeRulerPointerDown,
    onGlobalPointerMove,
    onGlobalPointerUp,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
  };
}
