import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  AddClipToTrackCommand,
  AddVirtualClipToTrackCommand,
  RemoveItemCommand,
  DeleteItemsCommand,
  MoveItemCommand,
  MoveItemsCommand,
  TrimItemCommand,
  SplitItemCommand,
  MoveItemToTrackCommand,
  OverlayPlaceItemCommand,
  OverlayTrimItemCommand,
  RenameItemCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
  TimelineCommandResult,
} from '../../commands';
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
  autoAdaptClipTransitions,
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

  if (item.clipType === 'media' && item.linkedVideoClipId && item.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
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

  if (track.kind === 'video' && item.clipType === 'media') {
    // Split locked linked audio that follows this video item.
    nextTracks = nextTracks.map((t) => {
      if (t.kind !== 'audio') return t;

      let changed = false;
      const patched: TimelineTrackItem[] = [];
      for (const it of t.items) {
        if (
          it.kind === 'clip' &&
          it.clipType === 'media' &&
          it.linkedVideoClipId === item.id &&
          it.lockToLinkedVideo
        ) {
          changed = true;
          const qAudioTimeline = quantizeRangeToFrames(it.timelineRange, fps);
          const audioStartUs = qAudioTimeline.startUs;
          const audioEndUs = audioStartUs + qAudioTimeline.durationUs;
          const audioStartFrame = usToFrame(audioStartUs, fps, 'round');
          const audioEndFrame = usToFrame(audioEndUs, fps, 'round');
          if (!(cutFrame > audioStartFrame && cutFrame < audioEndFrame)) {
            patched.push(it);
            continue;
          }

          const leftAudioDurationUs = Math.max(0, atUs - audioStartUs);
          const rightAudioDurationUs = Math.max(0, audioEndUs - atUs);
          const audioSpeed =
            typeof it.speed === 'number' && Number.isFinite(it.speed) ? (it.speed as number) : 1;
          const audioAbsSpeed = Math.abs(audioSpeed);
          const audioLocalCutUs = Math.max(
            0,
            Math.round((atUs - audioStartUs) * audioAbsSpeed),
          );

          let leftAudioSourceStartUs: number;
          let leftAudioSourceDurationUs: number;
          let rightAudioSourceStartUs: number;
          let rightAudioSourceDurationUs: number;

          if (audioSpeed >= 0) {
            leftAudioSourceStartUs = Math.round(it.sourceRange.startUs);
            leftAudioSourceDurationUs = Math.max(0, audioLocalCutUs);
            rightAudioSourceStartUs = Math.max(
              0,
              Math.round(it.sourceRange.startUs) + audioLocalCutUs,
            );
            rightAudioSourceDurationUs = Math.max(
              0,
              Math.round(it.sourceRange.durationUs) - audioLocalCutUs,
            );
          } else {
            const audioSourceDurationUs = Math.round(it.sourceRange.durationUs);
            leftAudioSourceStartUs = Math.max(
              0,
              Math.round(it.sourceRange.startUs) + audioSourceDurationUs - audioLocalCutUs,
            );
            leftAudioSourceDurationUs = Math.max(0, audioLocalCutUs);
            rightAudioSourceStartUs = Math.round(it.sourceRange.startUs);
            rightAudioSourceDurationUs = Math.max(0, audioSourceDurationUs - audioLocalCutUs);
          }

          const leftAudio: TimelineClipItem = {
            ...it,
            timelineRange: { startUs: audioStartUs, durationUs: leftAudioDurationUs },
            sourceRange: {
              startUs: leftAudioSourceStartUs,
              durationUs: leftAudioSourceDurationUs,
            },
            transitionOut: undefined,
            effects: it.effects ? cloneEffects(it.effects) : undefined,
            linkedGroupId: undefined,
          };

          // TODO(keyframes): shift keyframes relative time in rightAudio's effects by audioLocalCutUs
          const rightAudio: TimelineClipItem = {
            ...it,
            id: nextItemId(t.id, 'clip'),
            trackId: t.id,
            timelineRange: { startUs: atUs, durationUs: rightAudioDurationUs },
            sourceRange: {
              startUs: rightAudioSourceStartUs,
              durationUs: rightAudioSourceDurationUs,
            },
            linkedGroupId: undefined,
            linkedVideoClipId: rightItemId,
            transitionIn: undefined,
            effects: it.effects ? cloneEffects(it.effects) : undefined,
          };

          patched.push(leftAudio);
          patched.push(rightAudio);
        } else {
          patched.push(it);
        }
      }

      if (!changed) return t;
      patched.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return {
        ...t,
        items: normalizeGaps(doc, t.id, patched, { quantizeToFrames: shouldQuantizeToFrames }),
      };
    });
  }

  // After split clip durations may shrink — adapt transitions/fades that exceed the new size.
  nextTracks = nextTracks.map((t) => ({ ...t, items: autoAdaptClipTransitions(t.items) }));

  return { next: { ...doc, tracks: nextTracks } };
}
