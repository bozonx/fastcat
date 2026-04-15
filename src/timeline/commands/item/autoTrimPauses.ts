import type { TimelineDocument, TimelineMediaClipItem } from '../../types';
import type { AutoTrimPausesCommand, TimelineCommandResult } from '../../commands';
import { getTrackById, nextItemId, normalizeGaps, getDocFps, quantizeRangeToFrames, usToFrame, frameToUs } from '../utils';

/**
 * Atomic command handler for automatic silence trimming across multiple clips.
 * It performs splits and either marks or removes silence segments.
 */
export function autoTrimPauses(doc: TimelineDocument, cmd: AutoTrimPausesCommand): TimelineCommandResult {
  let nextDoc = doc;

  for (const target of cmd.clips) {
    const track = getTrackById(nextDoc, target.trackId);
    if (!track) continue;

    const originalItem = track.items.find((it) => it.id === target.itemId) as TimelineMediaClipItem | undefined;
    if (!originalItem || originalItem.kind !== 'clip') continue;

    // Sorting split points from RIGHT to LEFT to keep the original ID stable on the left part
    const splitPoints = target.pauses
      .flatMap((p) => [p.startUs, p.endUs])
      // Filter out points outside or exactly at boundaries
      .filter((t) => t > originalItem.timelineRange.startUs + 10 && t < originalItem.timelineRange.startUs + originalItem.timelineRange.durationUs - 10)
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
      return target.pauses.some(p => mid >= p.startUs - 100 && mid <= p.endUs + 100);
    };

    let currentItemId = originalItem.id;
    const itemsToMarkSilence: string[] = [];
    const itemsToDelete: string[] = [];

    for (const atUs of uniquePoints) {
      // Manual split logic similar to splitItem but simplified for batch
      const currentTrack = getTrackById(nextDoc, target.trackId);
      const item = currentTrack?.items.find(it => it.id === currentItemId) as TimelineMediaClipItem | undefined;
      if (!item || item.kind !== 'clip') break;

      const fps = getDocFps(nextDoc);
      const qTimeline = quantizeRangeToFrames(item.timelineRange, fps);
      const startUs = qTimeline.startUs;
      const endUs = startUs + qTimeline.durationUs;
      const cutFrame = usToFrame(atUs, fps, 'round');
      const quantizedAtUs = frameToUs(cutFrame, fps);

      if (!(quantizedAtUs > startUs && quantizedAtUs < endUs)) continue;

      const leftDurationUs = quantizedAtUs - startUs;
      const rightDurationUs = endUs - quantizedAtUs;
      const speed = item.speed ?? 1;
      const absSpeed = Math.abs(speed);
      const localCutUs = Math.round((quantizedAtUs - startUs) * absSpeed);

      const rightItemId = nextItemId(target.trackId, 'clip');

      let leftSourceStartUs: number;
      let leftSourceDurationUs: number;
      let rightSourceStartUs: number;
      let rightSourceDurationUs: number;

      if (speed >= 0) {
        leftSourceStartUs = Math.round(item.sourceRange.startUs);
        leftSourceDurationUs = localCutUs;
        rightSourceStartUs = Math.round(item.sourceRange.startUs) + localCutUs;
        rightSourceDurationUs = Math.round(item.sourceRange.durationUs) - localCutUs;
      } else {
        const sourceDurationUs = Math.round(item.sourceRange.durationUs);
        leftSourceStartUs = Math.round(item.sourceRange.startUs) + sourceDurationUs - localCutUs;
        leftSourceDurationUs = localCutUs;
        rightSourceStartUs = Math.round(item.sourceRange.startUs);
        rightSourceDurationUs = sourceDurationUs - localCutUs;
      }

      const leftPatched = {
        ...item,
        timelineRange: { startUs, durationUs: leftDurationUs },
        sourceRange: { startUs: leftSourceStartUs, durationUs: leftSourceDurationUs },
      };

      const rightItem = {
        ...item,
        id: rightItemId,
        timelineRange: { startUs: quantizedAtUs, durationUs: rightDurationUs },
        sourceRange: { startUs: rightSourceStartUs, durationUs: rightSourceDurationUs },
      };

      // Check if Right Item is silence
      if (isSilence(quantizedAtUs, endUs)) {
        if (cmd.mode === 'cut') itemsToDelete.push(rightItemId);
        else itemsToMarkSilence.push(rightItemId);
      }

      const nextItems = currentTrack!.items.flatMap(it => {
        if (it.id === currentItemId) return [leftPatched, rightItem];
        return [it];
      });

      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map(t => t.id === target.trackId ? { ...t, items: nextItems } : t)
      };
      
      // currentItemId stays same for next split (Left part)
    }

    // Final check for the remaining Left part
    const finalTrack = getTrackById(nextDoc, target.trackId);
    const finalLeft = finalTrack?.items.find(it => it.id === currentItemId) as TimelineMediaClipItem;
    if (finalLeft && isSilence(finalLeft.timelineRange.startUs, finalLeft.timelineRange.startUs + finalLeft.timelineRange.durationUs)) {
      if (cmd.mode === 'cut') itemsToDelete.push(currentItemId);
      else itemsToMarkSilence.push(currentItemId);
    }

    // Apply marked/cut actions
    if (cmd.mode === 'mark') {
      const silenceSet = new Set(itemsToMarkSilence);
      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map(t => ({
          ...t,
          items: t.items.map(it => silenceSet.has(it.id) ? { ...it, ignored: true } as any : it)
        }))
      };
    } else {
      const deleteSet = new Set(itemsToDelete);
      nextDoc = {
        ...nextDoc,
        tracks: nextDoc.tracks.map(t => {
           const nextItems = t.items.filter(it => !deleteSet.has(it.id));
           return { ...t, items: normalizeGaps(nextDoc, t.id, nextItems, { quantizeToFrames: true }) };
        })
      };
    }
    
    // Since some items might have been deleted, we should be careful with allCreatedItemIds.
    // We only return IDs that exist in the final doc and are not ignored if mode is mark?
    // User expects to see the resulting "speech" clips selected?
    // Actually, usually after Auto Montage we might want to keep the speech clips selected.
  }

  return { next: nextDoc };
}
