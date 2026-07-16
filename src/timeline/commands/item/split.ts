import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type { SplitItemCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTicksToFrames,
  ticksToFrame,
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
  const startTicks = Math.max(0, Math.round(item.timelineRange.startTicks));
  const endTicks = startTicks + Math.max(0, Math.round(item.timelineRange.durationTicks));

  const atTicksRaw = Math.max(0, Math.round(Number(cmd.atTicks)));
  const atTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(atTicksRaw, fps, 'round')
    : atTicksRaw;

  if (!(atTicks > startTicks && atTicks < endTicks)) {
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

        const clipStartTicks = it.timelineRange.startTicks;
        const clipEndTicks = clipStartTicks + it.timelineRange.durationTicks;
        const clipStartFrame = ticksToFrame(clipStartTicks, fps, 'round');
        const clipEndFrame = ticksToFrame(clipEndTicks, fps, 'round');
        const cutFrameForClip = ticksToFrame(atTicks, fps, 'round');

        const isSplit = shouldQuantizeToFrames
          ? cutFrameForClip > clipStartFrame && cutFrameForClip < clipEndFrame
          : atTicks > clipStartTicks && atTicks < clipEndTicks;

        if (isSplit) {
          trackItemsChanged = true;

          const leftDurationTicks = Math.max(0, atTicks - clipStartTicks);
          const rightDurationTicks = Math.max(0, clipEndTicks - atTicks);

          const speed = typeof it.speed === 'number' && Number.isFinite(it.speed) ? it.speed : 1;
          const absSpeed = Math.abs(speed);
          const localCutTicks = Math.max(0, Math.round((atTicks - clipStartTicks) * absSpeed));

          let leftSourceStartTicks: number;
          let leftSourceDurationTicks: number;
          let rightSourceStartTicks: number;
          let rightSourceDurationTicks: number;

          if (speed >= 0) {
            leftSourceStartTicks = Math.round(it.sourceRange.startTicks);
            leftSourceDurationTicks = Math.max(0, localCutTicks);
            rightSourceStartTicks = Math.max(
              0,
              Math.round(it.sourceRange.startTicks) + localCutTicks,
            );
            rightSourceDurationTicks = Math.max(
              0,
              Math.round(it.sourceRange.durationTicks) - localCutTicks,
            );
          } else {
            const sourceDurationTicks = Math.round(it.sourceRange.durationTicks);
            leftSourceStartTicks = Math.max(
              0,
              Math.round(it.sourceRange.startTicks) + sourceDurationTicks - localCutTicks,
            );
            leftSourceDurationTicks = localCutTicks;
            rightSourceStartTicks = Math.round(it.sourceRange.startTicks);
            rightSourceDurationTicks = Math.max(0, sourceDurationTicks - localCutTicks);
          }

          const rightItemId = nextItemId(t.id, 'clip');
          createdItemIds.push(rightItemId);

          const leftPatched: TimelineClipItem = {
            ...(it as TimelineClipItem),
            timelineRange: { startTicks: clipStartTicks, durationTicks: leftDurationTicks },
            sourceRange: {
              startTicks: leftSourceStartTicks,
              durationTicks: leftSourceDurationTicks,
            },
            transitionOut: undefined,
            effects: it.effects ? cloneEffects(it.effects) : undefined,
            linkedGroupId: leftGroupId,
          };

          const rightItem: TimelineClipItem = {
            ...(it as TimelineClipItem),
            id: rightItemId,
            trackId: t.id,
            timelineRange: { startTicks: atTicks, durationTicks: rightDurationTicks },
            sourceRange: {
              startTicks: rightSourceStartTicks,
              durationTicks: rightSourceDurationTicks,
            },
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
            : clipStartTicks < atTicks;

          const nextGroupId = isLeft ? leftGroupId : rightGroupId;
          trackItemsChanged = true;
          nextItemsRaw.push({
            ...it,
            linkedGroupId: nextGroupId,
          });
        }
      }

      if (!trackItemsChanged) return t;

      nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
      const nextItems = normalizeGaps(doc, t.id, nextItemsRaw, {
        quantizeToFrames: shouldQuantizeToFrames,
      });

      return { ...t, items: nextItems };
    });

    nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);
    return { next: { ...doc, tracks: nextTracks }, createdItemIds };
  }

  const leftDurationTicks = Math.max(0, atTicks - startTicks);
  const rightDurationTicks = Math.max(0, endTicks - atTicks);
  if (leftDurationTicks <= 0 || rightDurationTicks <= 0) return { next: doc };

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const absSpeed = Math.abs(speed);
  const localCutTicks = Math.max(0, Math.round((atTicks - startTicks) * absSpeed));

  let leftSourceStartTicks: number;
  let leftSourceDurationTicks: number;
  let rightSourceStartTicks: number;
  let rightSourceDurationTicks: number;

  if (speed >= 0) {
    leftSourceStartTicks = Math.round(item.sourceRange.startTicks);
    leftSourceDurationTicks = Math.max(0, localCutTicks);
    rightSourceStartTicks = Math.max(0, Math.round(item.sourceRange.startTicks) + localCutTicks);
    rightSourceDurationTicks = Math.max(
      0,
      Math.round(item.sourceRange.durationTicks) - localCutTicks,
    );
  } else {
    // For reversed clips, the left part of the timeline is the later part of the source range.
    const sourceDurationTicks = Math.round(item.sourceRange.durationTicks);
    leftSourceStartTicks = Math.max(
      0,
      Math.round(item.sourceRange.startTicks) + sourceDurationTicks - localCutTicks,
    );
    leftSourceDurationTicks = localCutTicks;
    rightSourceStartTicks = Math.round(item.sourceRange.startTicks);
    rightSourceDurationTicks = Math.max(0, sourceDurationTicks - localCutTicks);
  }

  const rightItemId = nextItemId(track.id, 'clip');

  const leftPatched: TimelineClipItem = {
    ...(item as TimelineClipItem),
    timelineRange: { startTicks, durationTicks: leftDurationTicks },
    sourceRange: { startTicks: leftSourceStartTicks, durationTicks: leftSourceDurationTicks },
    transitionOut: undefined,
    effects: item.effects ? cloneEffects(item.effects) : undefined,
    linkedGroupId: undefined,
  };

  const rightItem: TimelineClipItem = {
    ...(item as TimelineClipItem),
    id: rightItemId,
    trackId: track.id,
    timelineRange: { startTicks: atTicks, durationTicks: rightDurationTicks },
    sourceRange: { startTicks: rightSourceStartTicks, durationTicks: rightSourceDurationTicks },
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
  nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks }, createdItemIds: [rightItemId] };
}
