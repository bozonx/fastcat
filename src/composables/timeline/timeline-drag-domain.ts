import { TICKS_PER_SECOND } from '~/utils/time';
import type {
  TimelineDocument,
  TimelineMarker,
  TimelineTrack,
  TimelineSelectionRange,
} from '~/timeline/types';

import {
  pickBestSnapCandidateTicks,
  sanitizeSnapTargetsTicks,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import type { FastCatUserSettings } from '~/utils/settings';
import { querySelectorAll, elementsFromPoint } from '~/utils/browser-api';

export interface TimelineMoveOperation {
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startTicks: number;
}

export function computeSnapTargetsTicks(params: {
  tracks: TimelineTrack[];
  /** Clip ids being dragged — excluded so a moving group never snaps to itself. */
  excludeItemIds?: string[];
  /** Marker id being dragged — excluded so a marker never snaps to its own origin. */
  excludeMarkerId?: string;
  includeTimelineStart: boolean;
  includeTimelineEndTicks: number | null;
  includePlayheadTicks: number | null;
  includeMarkers: boolean;
  markers: TimelineMarker[];
  includeClips: boolean;
  selectionRangeTicks?: TimelineSelectionRange | null;
}): number[] {
  const targets: number[] = [];
  if (params.includeTimelineStart) targets.push(0);
  if (
    typeof params.includeTimelineEndTicks === 'number' &&
    Number.isFinite(params.includeTimelineEndTicks)
  ) {
    targets.push(params.includeTimelineEndTicks);
  }
  if (typeof params.includePlayheadTicks === 'number' && Number.isFinite(params.includePlayheadTicks)) {
    targets.push(params.includePlayheadTicks);
  }

  if (params.includeMarkers) {
    for (const marker of params.markers) {
      if (params.excludeMarkerId && marker.id === params.excludeMarkerId) continue;
      if (!Number.isFinite(marker.timeTicks)) continue;
      targets.push(marker.timeTicks);
      if (typeof marker.durationTicks === 'number' && Number.isFinite(marker.durationTicks)) {
        targets.push(marker.timeTicks + marker.durationTicks);
      }
    }
  }

  if (params.selectionRangeTicks) {
    if (Number.isFinite(params.selectionRangeTicks.startTicks)) {
      targets.push(params.selectionRangeTicks.startTicks);
    }
    if (Number.isFinite(params.selectionRangeTicks.endTicks)) {
      targets.push(params.selectionRangeTicks.endTicks);
    }
  }

  if (params.includeClips) {
    for (const track of params.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (params.excludeItemIds && params.excludeItemIds.includes(item.id)) continue;
        targets.push(item.timelineRange.startTicks);
        targets.push(item.timelineRange.startTicks + item.timelineRange.durationTicks);
      }
    }
  }

  return sanitizeSnapTargetsTicks(targets);
}

export interface ResolvePlayheadClickTimeUsParams {
  rawTimeTicks: number;
  zoom: number;
  snapThresholdPx: number;
  toolbarSnapMode: 'snap' | 'no_snap';
  snapping: FastCatUserSettings['timeline']['snapping'];
  tracks: TimelineTrack[];
  markers: TimelineMarker[];
  durationTicks: number | null;
  selectionRangeTicks?: TimelineSelectionRange | null;
}

export function resolvePlayheadClickTimeTicks(params: ResolvePlayheadClickTimeUsParams): number {
  const rawTimeTicks = Math.max(0, Math.round(params.rawTimeTicks));

  if (!params.snapping.playheadClick || params.toolbarSnapMode !== 'snap') {
    return rawTimeTicks;
  }

  const targetsTicks = computeSnapTargetsTicks({
    tracks: params.tracks,
    includeTimelineStart: params.snapping.timelineEdges,
    includeTimelineEndTicks: params.snapping.timelineEdges ? params.durationTicks : null,
    includePlayheadTicks: null,
    includeMarkers: params.snapping.markers,
    markers: params.markers,
    includeClips: params.snapping.clips,
    selectionRangeTicks: params.snapping.selection ? params.selectionRangeTicks : null,
  });

  if (targetsTicks.length === 0) {
    return rawTimeTicks;
  }

  const thresholdTicks = Math.round(
    (params.snapThresholdPx / zoomToPxPerSecond(params.zoom)) * TICKS_PER_SECOND,
  );
  const snap = pickBestSnapCandidateTicks({
    rawTicks: rawTimeTicks,
    thresholdTicks,
    targetsTicks,
  });

  return snap.distTicks < thresholdTicks ? snap.snappedTicks : rawTimeTicks;
}

export function getSelectedMovableItemIds(params: {
  selectedItemIds: string[];
  tracks: TimelineTrack[];
}): string[] {
  return params.selectedItemIds.filter((selectedId) => {
    const track = params.tracks.find((t) =>
      t.items.some((trackItem) => trackItem.id === selectedId),
    );
    if (!track || track.locked) return false;

    const selectedItem = track?.items.find((trackItem) => trackItem.id === selectedId);
    return selectedItem?.kind === 'clip' && !selectedItem.locked;
  });
}

export function resolveMoveTargetTrackId(params: {
  clientX: number;
  clientY: number;
  draggingTrackId: string;
  tracks: TimelineTrack[];
}): string {
  let hoverTrackId: string | null = null;

  const trackElements = Array.from(querySelectorAll<HTMLElement>('[data-track-id]'));
  const sortedTrackElements = trackElements.sort((left, right) => {
    return left.getBoundingClientRect().top - right.getBoundingClientRect().top;
  });

  for (const element of sortedTrackElements) {
    const rect = element.getBoundingClientRect();
    if (params.clientY >= rect.top && params.clientY <= rect.bottom) {
      hoverTrackId = element.dataset.trackId ?? null;
      if (hoverTrackId) {
        break;
      }
    }
  }

  if (!hoverTrackId) {
    const elements = elementsFromPoint(params.clientX, params.clientY);
    for (const el of elements) {
      const trackId =
        (el as HTMLElement).dataset?.trackId ??
        el.closest('[data-track-id]')?.getAttribute('data-track-id') ??
        null;
      if (trackId) {
        hoverTrackId = trackId;
        break;
      }
    }
  }

  if (!hoverTrackId || hoverTrackId === params.draggingTrackId) {
    return params.draggingTrackId;
  }

  const fromTrack = params.tracks.find((track) => track.id === params.draggingTrackId);
  const toTrack = params.tracks.find((track) => track.id === hoverTrackId);
  if (!fromTrack || !toTrack || fromTrack.kind !== toTrack.kind || toTrack.locked) {
    return params.draggingTrackId;
  }

  return hoverTrackId;
}

export function buildMultiItemMoves(params: {
  currentTracks: TimelineTrack[];
  dragStartSnapshot: TimelineDocument;
  dragOriginTrackId: string | null;
  targetTrackId: string;
  selectedMovableItemIds: string[];
  deltaTicks: number;
}): TimelineMoveOperation[] {
  const moves: TimelineMoveOperation[] = [];

  // Clamp the shared delta ONCE against the earliest selected clip so the group
  // never crosses 0. Clamping each start independently (`max(0, start + delta)`)
  // would pile the leftmost members at 0 while the rest keep moving, collapsing
  // the group's relative geometry. This mirrors the linked-clip move path.
  let minSelectedStartTicks = Number.POSITIVE_INFINITY;
  for (const track of params.dragStartSnapshot.tracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (!params.selectedMovableItemIds.includes(item.id)) continue;
      minSelectedStartTicks = Math.min(minSelectedStartTicks, item.timelineRange.startTicks);
    }
  }
  const clampedDeltaTicks = Number.isFinite(minSelectedStartTicks)
    ? Math.max(params.deltaTicks, -minSelectedStartTicks)
    : params.deltaTicks;

  let trackOffset = 0;
  if (params.targetTrackId !== params.dragOriginTrackId) {
    const originTrackIndex = params.currentTracks.findIndex(
      (track) => track.id === params.dragOriginTrackId,
    );
    const targetTrackIndex = params.currentTracks.findIndex(
      (track) => track.id === params.targetTrackId,
    );

    if (originTrackIndex !== -1 && targetTrackIndex !== -1) {
      trackOffset = targetTrackIndex - originTrackIndex;
    }
  }

  for (const selectedId of params.selectedMovableItemIds) {
    let originalTrackId = '';
    let originalStartTicks = 0;

    for (const track of params.dragStartSnapshot.tracks) {
      const item = track.items.find((value) => value.id === selectedId);
      if (item && item.kind === 'clip') {
        originalTrackId = track.id;
        originalStartTicks = item.timelineRange.startTicks;
        break;
      }
    }

    let currentTrackId = '';
    for (const track of params.currentTracks) {
      if (track.items.some((value) => value.id === selectedId)) {
        currentTrackId = track.id;
        break;
      }
    }

    if (!originalTrackId || !currentTrackId) continue;

    let toTrackId = originalTrackId;
    if (trackOffset !== 0) {
      const originalTrackIndex = params.currentTracks.findIndex(
        (track) => track.id === originalTrackId,
      );
      const nextTrackIndex = originalTrackIndex + trackOffset;

      if (nextTrackIndex >= 0 && nextTrackIndex < params.currentTracks.length) {
        const nextTrack = params.currentTracks[nextTrackIndex];
        const originalTrack = params.currentTracks[originalTrackIndex];
        if (nextTrack && originalTrack && nextTrack.kind === originalTrack.kind) {
          toTrackId = nextTrack.id;
        }
      }
    }

    moves.push({
      fromTrackId: currentTrackId,
      toTrackId,
      itemId: selectedId,
      startTicks: Math.max(0, originalStartTicks + clampedDeltaTicks),
    });
  }

  moves.sort((left, right) => {
    return clampedDeltaTicks >= 0 ? right.startTicks - left.startTicks : left.startTicks - right.startTicks;
  });

  return moves;
}
