import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type { SplitItemCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  usToFrame,
  frameToUs,
  assertClipNotLocked,
  nextItemId,
  normalizeGaps,
  quantizeRangeToFrames,
  autoAdaptChangedTracks,
} from '../utils';
import { cloneValue } from '~/utils/clone';

function cloneEffects<T>(value: T): T {
  // structuredClone in modern runtimes; fallback to JSON-clone. The previous
  // implementation silently returned the original ref on failure, so editing
  // effects on the left half of a split leaked into the right half. Now we
  // ensure a fresh ref by manually walking arrays of plain objects when the
  // structured/JSON paths fail.
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
  const qTimeline = quantizeRangeToFrames(item.timelineRange, fps);
  const startUs = qTimeline.startUs;
  const endUs = startUs + qTimeline.durationUs;

  const startFrame = usToFrame(startUs, fps, 'round');
  const endFrame = usToFrame(endUs, fps, 'round');
  const cutFrameCandidate = shouldQuantizeToFrames
    ? usToFrame(quantizeTimeUsToFrames(Number(cmd.atUs), fps, 'round'), fps, 'round')
    : usToFrame(Number(cmd.atUs), fps, 'round');
  const cutFrame = cutFrameCandidate;

  if (!(cutFrame > startFrame && cutFrame < endFrame)) {
    return { next: doc };
  }

  const atUs = shouldQuantizeToFrames ? frameToUs(cutFrame, fps) : Number(cmd.atUs);

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
    // Drop linkedGroupId on both halves: split breaks the original logical group.
    linkedGroupId: undefined,
  };

  // TODO(keyframes): shift keyframes relative time in rightItem's effects by localCutUs
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



  // After split clip durations may shrink — adapt transitions/fades that exceed the new size.
  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}
