import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type { SplitItemCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  usToFrame,
  assertClipNotLocked,
  nextItemId,
  normalizeGaps,
  autoAdaptChangedTracks,
  getLinkedClipGroupItemIds,
} from '../utils';
import { cloneValue } from '~/utils/clone';
import { createLinkedGroupId } from '~/timeline/id';

function cloneEffects<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const cloned = cloneValue(value);
  if (cloned !== value) return cloned;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneEffects(entry)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = cloneEffects((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

export function splitItem(doc: TimelineDocument, cmd: SplitItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'split');
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;

  // Splitting must NEVER re-grid the clip's own outer boundaries — a frame-aligned
  // clip's edges are already on the grid, and a free (sub-frame) audio clip must
  // keep its hand-dialed phase (e.g. a multi-mic sync). Only the CUT point is
  // frame-quantized, and only when requested. Previously the outer edges were run
  // through `quantizeRangeToFrames` unconditionally, which snapped free clips onto
  // the grid on every split.
  const startUs = Math.max(0, Math.round(item.timelineRange.startUs));
  const endUs = startUs + Math.max(0, Math.round(item.timelineRange.durationUs));

  const atUsRaw = Math.max(0, Math.round(Number(cmd.atUs)));
  const atUs = shouldQuantizeToFrames ? quantizeTimeUsToFrames(atUsRaw, fps, 'round') : atUsRaw;

  if (!(atUs > startUs && atUs < endUs)) {
    return { next: doc };
  }

  // If the clip is in a group, we perform a grouped split
  if (item.linkedGroupId) {
    const leftGroupId = createLinkedGroupId();
    const rightGroupId = createLinkedGroupId();
    const groupItemIds = new Set(getLinkedClipGroupItemIds(doc, item.id));

    const createdItemIds: string[] = [];

    let nextTracks = doc.tracks.map((t) => {
      const hasGroupClip = t.items.some((it) => groupItemIds.has(it.id));
      if (!hasGroupClip) return t;

      let trackItemsChanged = false;
      const nextItemsRaw: TimelineTrackItem[] = [];

      for (const it of t.items) {
        if (it.kind !== 'clip' || !groupItemIds.has(it.id)) {
          nextItemsRaw.push(it);
          continue;
        }

        const clipStartUs = it.timelineRange.startUs;
        const clipEndUs = clipStartUs + it.timelineRange.durationUs;
        const clipStartFrame = usToFrame(clipStartUs, fps, 'round');
        const clipEndFrame = usToFrame(clipEndUs, fps, 'round');
        const cutFrameForClip = usToFrame(atUs, fps, 'round');

        const isSplit = shouldQuantizeToFrames
          ? cutFrameForClip > clipStartFrame && cutFrameForClip < clipEndFrame
          : atUs > clipStartUs && atUs < clipEndUs;

        if (isSplit) {
          trackItemsChanged = true;

          const leftDurationUs = Math.max(0, atUs - clipStartUs);
          const rightDurationUs = Math.max(0, clipEndUs - atUs);

          const speed = typeof it.speed === 'number' && Number.isFinite(it.speed) ? it.speed : 1;
          const absSpeed = Math.abs(speed);
          const localCutUs = Math.max(0, Math.round((atUs - clipStartUs) * absSpeed));

          let leftSourceStartUs: number;
          let leftSourceDurationUs: number;
          let rightSourceStartUs: number;
          let rightSourceDurationUs: number;

          if (speed >= 0) {
            leftSourceStartUs = Math.round(it.sourceRange.startUs);
            leftSourceDurationUs = Math.max(0, localCutUs);
            rightSourceStartUs = Math.max(0, Math.round(it.sourceRange.startUs) + localCutUs);
            rightSourceDurationUs = Math.max(0, Math.round(it.sourceRange.durationUs) - localCutUs);
          } else {
            const sourceDurationUs = Math.round(it.sourceRange.durationUs);
            leftSourceStartUs = Math.max(
              0,
              Math.round(it.sourceRange.startUs) + sourceDurationUs - localCutUs,
            );
            leftSourceDurationUs = localCutUs;
            rightSourceStartUs = Math.round(it.sourceRange.startUs);
            rightSourceDurationUs = Math.max(0, sourceDurationUs - localCutUs);
          }

          const rightItemId = nextItemId(t.id, 'clip');
          createdItemIds.push(rightItemId);

          const leftPatched: TimelineClipItem = {
            ...(it as TimelineClipItem),
            timelineRange: { startUs: clipStartUs, durationUs: leftDurationUs },
            sourceRange: { startUs: leftSourceStartUs, durationUs: leftSourceDurationUs },
            transitionOut: undefined,
            effects: it.effects ? cloneEffects(it.effects) : undefined,
            linkedGroupId: leftGroupId,
          };

          const rightItem: TimelineClipItem = {
            ...(it as TimelineClipItem),
            id: rightItemId,
            trackId: t.id,
            timelineRange: { startUs: atUs, durationUs: rightDurationUs },
            sourceRange: { startUs: rightSourceStartUs, durationUs: rightSourceDurationUs },
            linkedGroupId: rightGroupId,
            transitionIn: undefined,
            effects: it.effects ? cloneEffects(it.effects) : undefined,
          };

          nextItemsRaw.push(leftPatched);
          nextItemsRaw.push(rightItem);
        } else {
          // Reassign uncut clip to the left or right group depending on its position
          const isLeft = shouldQuantizeToFrames
            ? clipStartFrame < cutFrameForClip
            : clipStartUs < atUs;

          const nextGroupId = isLeft ? leftGroupId : rightGroupId;
          trackItemsChanged = true;
          nextItemsRaw.push({
            ...it,
            linkedGroupId: nextGroupId,
          });
        }
      }

      if (!trackItemsChanged) return t;

      nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      const nextItems = normalizeGaps(doc, t.id, nextItemsRaw, {
        quantizeToFrames: shouldQuantizeToFrames,
      });

      return { ...t, items: nextItems };
    });

    nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);
    return { next: { ...doc, tracks: nextTracks }, createdItemIds };
  }

  const leftDurationUs = Math.max(0, atUs - startUs);
  const rightDurationUs = Math.max(0, endUs - atUs);
  if (leftDurationUs <= 0 || rightDurationUs <= 0) return { next: doc };

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const absSpeed = Math.abs(speed);
  const localCutUs = Math.max(0, Math.round((atUs - startUs) * absSpeed));

  let leftSourceStartUs: number;
  let leftSourceDurationUs: number;
  let rightSourceStartUs: number;
  let rightSourceDurationUs: number;

  if (speed >= 0) {
    leftSourceStartUs = Math.round(item.sourceRange.startUs);
    leftSourceDurationUs = Math.max(0, localCutUs);
    rightSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs) + localCutUs);
    rightSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs) - localCutUs);
  } else {
    // For reversed clips, the left part of the timeline is the later part of the source range.
    const sourceDurationUs = Math.round(item.sourceRange.durationUs);
    leftSourceStartUs = Math.max(
      0,
      Math.round(item.sourceRange.startUs) + sourceDurationUs - localCutUs,
    );
    leftSourceDurationUs = localCutUs;
    rightSourceStartUs = Math.round(item.sourceRange.startUs);
    rightSourceDurationUs = Math.max(0, sourceDurationUs - localCutUs);
  }

  const rightItemId = nextItemId(track.id, 'clip');

  const leftPatched: TimelineClipItem = {
    ...(item as TimelineClipItem),
    timelineRange: { startUs, durationUs: leftDurationUs },
    sourceRange: { startUs: leftSourceStartUs, durationUs: leftSourceDurationUs },
    transitionOut: undefined,
    effects: item.effects ? cloneEffects(item.effects) : undefined,
    linkedGroupId: undefined,
  };

  const rightItem: TimelineClipItem = {
    ...(item as TimelineClipItem),
    id: rightItemId,
    trackId: track.id,
    timelineRange: { startUs: atUs, durationUs: rightDurationUs },
    sourceRange: { startUs: rightSourceStartUs, durationUs: rightSourceDurationUs },
    linkedGroupId: undefined,
    transitionIn: undefined,
    effects: item.effects ? cloneEffects(item.effects) : undefined,
  };

  const nextItemsRaw: TimelineTrackItem[] = [];
  for (const it of track.items) {
    if (it.id !== item.id) {
      nextItemsRaw.push(it);
      continue;
    }
    nextItemsRaw.push(leftPatched);
    nextItemsRaw.push(rightItem);
  }
  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks }, createdItemIds: [rightItemId] };
}
