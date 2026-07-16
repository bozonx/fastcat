import type { TimelineDocument, TimelineMediaClipItem, TimelineTrackItem } from '../../types';
import type { AutoTrimPausesCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  nextItemId,
  normalizeGaps,
  getDocFps,
  quantizeRangeToFrames,
  ticksToFrame,
  frameToTicks,
  autoAdaptChangedTracks,
} from '../utils';

/**
 * Atomic command handler for automatic silence trimming across multiple clips.
 * It performs splits and either marks or removes silence segments.
 */
export function autoTrimPauses(
  doc: TimelineDocument,
  cmd: AutoTrimPausesCommand,
): TimelineCommandResult {
  let nextDoc = doc;

  for (const target of cmd.clips) {
    const track = getTrackById(nextDoc, target.trackId);
    if (!track) continue;

    const originalItem = track.items.find((it) => it.id === target.itemId) as
      | TimelineMediaClipItem
      | undefined;
    if (!originalItem || originalItem.kind !== 'clip') continue;

    // Sorting split points from RIGHT to LEFT to keep the original ID stable on the left part
    const splitPoints = target.pauses
      .flatMap((p) => [p.startTicks, p.endTicks])
      // Filter out points outside or exactly at boundaries
      .filter(
        (t) =>
          t > originalItem.timelineRange.startTicks + 10 &&
          t < originalItem.timelineRange.startTicks + originalItem.timelineRange.durationTicks - 10,
      )
      .sort((a, b) => b - a);

    // De-duplicate if any
    const uniquePoints: number[] = [];
    for (const p of splitPoints) {
      if (uniquePoints.length === 0 || Math.abs(uniquePoints[uniquePoints.length - 1]! - p) > 100) {
        uniquePoints.push(p);
      }
    }

    const isSilence = (start: number, end: number) => {
      const mid = (start + end) / 2;
      return target.pauses.some((p) => mid >= p.startTicks - 100 && mid <= p.endTicks + 100);
    };

    const currentItemId = originalItem.id;
    const itemsToMarkSilence: string[] = [];
    const itemsToDelete: string[] = [];

    for (const atTicks of uniquePoints) {
      // Manual split logic similar to splitItem but simplified for batch
      const currentTrack = getTrackById(nextDoc, target.trackId);
      const item = currentTrack?.items.find((it) => it.id === currentItemId) as
        | TimelineMediaClipItem
        | undefined;
      if (!item || item.kind !== 'clip') break;

      const fps = getDocFps(nextDoc);
      const qTimeline = quantizeRangeToFrames(item.timelineRange, fps);
      const startTicks = qTimeline.startTicks;
      const endTicks = startTicks + qTimeline.durationTicks;
      const cutFrame = ticksToFrame(atTicks, fps, 'round');
      const quantizedAtTicks = frameToTicks(cutFrame, fps);

      if (!(quantizedAtTicks > startTicks && quantizedAtTicks < endTicks)) continue;

      const leftDurationTicks = Math.max(0, quantizedAtTicks - startTicks);
      const rightDurationTicks = Math.max(0, endTicks - quantizedAtTicks);
      const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
      const absSpeed = Math.abs(speed) || 1;
      const localCutTicks = Math.max(0, Math.round((quantizedAtTicks - startTicks) * absSpeed));

      const rightItemId = nextItemId(target.trackId, 'clip');

      let leftSourceStartTicks: number;
      let leftSourceDurationTicks: number;
      let rightSourceStartTicks: number;
      let rightSourceDurationTicks: number;

      const sourceDurationTicks = Math.max(0, Math.round(item.sourceRange.durationTicks));
      const safeLocalCutTicks = Math.min(localCutTicks, sourceDurationTicks);

      if (speed >= 0) {
        leftSourceStartTicks = Math.max(0, Math.round(item.sourceRange.startTicks));
        leftSourceDurationTicks = safeLocalCutTicks;
        rightSourceStartTicks = Math.max(0, Math.round(item.sourceRange.startTicks) + safeLocalCutTicks);
        rightSourceDurationTicks = Math.max(0, sourceDurationTicks - safeLocalCutTicks);
      } else {
        leftSourceStartTicks = Math.max(
          0,
          Math.round(item.sourceRange.startTicks) + sourceDurationTicks - safeLocalCutTicks,
        );
        leftSourceDurationTicks = safeLocalCutTicks;
        rightSourceStartTicks = Math.max(0, Math.round(item.sourceRange.startTicks));
        rightSourceDurationTicks = Math.max(0, sourceDurationTicks - safeLocalCutTicks);
      }

      const leftPatched: TimelineMediaClipItem = {
        ...item,
        timelineRange: { startTicks, durationTicks: leftDurationTicks },
        sourceRange: { startTicks: leftSourceStartTicks, durationTicks: leftSourceDurationTicks },
        transitionOut: undefined,
        linkedGroupId: undefined,
      };

      const rightItem: TimelineMediaClipItem = {
        ...item,
        id: rightItemId,
        timelineRange: { startTicks: quantizedAtTicks, durationTicks: rightDurationTicks },
        sourceRange: { startTicks: rightSourceStartTicks, durationTicks: rightSourceDurationTicks },
        transitionIn: undefined,
        linkedGroupId: undefined,
      };

      // Check if Right Item is silence
      if (isSilence(quantizedAtTicks, endTicks)) {
        if (cmd.mode === 'cut') itemsToDelete.push(rightItemId);
        else itemsToMarkSilence.push(rightItemId);
      }

      const nextItems = currentTrack!.items.flatMap((it) => {
        if (it.id === currentItemId) return [leftPatched, rightItem];
        return [it];
      });

      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map((t) =>
          t.id === target.trackId ? { ...t, items: nextItems } : t,
        ),
      };

      // currentItemId stays same for next split (Left part)
    }

    // Final check for the remaining Left part
    const finalTrack = getTrackById(nextDoc, target.trackId);
    const finalLeft = finalTrack?.items.find(
      (it) => it.id === currentItemId,
    ) as TimelineMediaClipItem;
    if (
      finalLeft &&
      isSilence(
        finalLeft.timelineRange.startTicks,
        finalLeft.timelineRange.startTicks + finalLeft.timelineRange.durationTicks,
      )
    ) {
      if (cmd.mode === 'cut') itemsToDelete.push(currentItemId);
      else itemsToMarkSilence.push(currentItemId);
    }

    // Apply marked/cut actions — only on the target track to avoid touching unrelated tracks.
    if (cmd.mode === 'mark') {
      const silenceSet = new Set(itemsToMarkSilence);
      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map((t) =>
          t.id === target.trackId
            ? {
                ...t,
                items: t.items.map((it) =>
                  silenceSet.has(it.id) && it.kind === 'clip'
                    ? ({ ...it, disabled: true } as TimelineTrackItem)
                    : it,
                ),
              }
            : t,
        ),
      };
    } else {
      const deleteSet = new Set(itemsToDelete);
      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map((t) => {
          if (t.id !== target.trackId) return t;
          const nextItems = t.items.filter((it) => !deleteSet.has(it.id));
          return {
            ...t,
            items: normalizeGaps(nextDoc, t.id, nextItems, { quantizeToFrames: true }),
          };
        }),
      };
    }
  }

  // Shrink fades/transitions that may now exceed the new (shorter) clip durations.
  nextDoc = {
    ...nextDoc,
    tracks: autoAdaptChangedTracks(doc.tracks, nextDoc.tracks),
  };

  return { next: nextDoc };
}
