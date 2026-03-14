import type { TimelineDocument, TimelineMarker, TimelineTrack } from '~/timeline/types';

import { sanitizeSnapTargetsUs } from '~/utils/timeline/geometry';

export interface TimelineMoveOperation {
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startUs: number;
}

export function computeSnapTargetsUs(params: {
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
    for (const marker of params.markers) {
      if (!Number.isFinite(marker.timeUs)) continue;
      targets.push(marker.timeUs);
      if (typeof marker.durationUs === 'number' && Number.isFinite(marker.durationUs)) {
        targets.push(marker.timeUs + marker.durationUs);
      }
    }
  }

  for (const track of params.tracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.id === params.excludeItemId) continue;
      targets.push(item.timelineRange.startUs);
      targets.push(item.timelineRange.startUs + item.timelineRange.durationUs);
    }
  }

  return sanitizeSnapTargetsUs(targets);
}

export function getSelectedMovableItemIds(params: {
  selectedItemIds: string[];
  tracks: TimelineTrack[];
}): string[] {
  return params.selectedItemIds.filter((selectedId) => {
    const selectedItem = params.tracks
      .find((track) => track.items.some((trackItem) => trackItem.id === selectedId))
      ?.items.find((trackItem) => trackItem.id === selectedId);

    return selectedItem?.kind === 'clip' && !selectedItem.locked;
  });
}

export function resolveMoveTargetTrackId(params: {
  clientX: number;
  clientY: number;
  draggingTrackId: string;
  tracks: TimelineTrack[];
}): string {
  const trackEl = document
    .elementFromPoint(params.clientX, params.clientY)
    ?.closest('[data-track-id]');
  const hoverTrackId = trackEl?.getAttribute('data-track-id');
  if (!hoverTrackId || hoverTrackId === params.draggingTrackId) {
    return params.draggingTrackId;
  }

  const fromTrack = params.tracks.find((track) => track.id === params.draggingTrackId);
  const toTrack = params.tracks.find((track) => track.id === hoverTrackId);
  if (!fromTrack || !toTrack || fromTrack.kind !== toTrack.kind) {
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
  deltaUs: number;
}): TimelineMoveOperation[] {
  const moves: TimelineMoveOperation[] = [];

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
    let originalStartUs = 0;

    for (const track of params.dragStartSnapshot.tracks) {
      const item = track.items.find((value) => value.id === selectedId);
      if (item && item.kind === 'clip') {
        originalTrackId = track.id;
        originalStartUs = item.timelineRange.startUs;
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
      startUs: Math.max(0, originalStartUs + params.deltaUs),
    });
  }

  moves.sort((left, right) => {
    return params.deltaUs >= 0 ? right.startUs - left.startUs : left.startUs - right.startUs;
  });

  return moves;
}
