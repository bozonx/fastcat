import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../types';
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
} from '../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  usToFrame,
  frameToUs,
  computeTrackEndUs,
  assertNoOverlap,
  nextItemId,
  sliceTrackItemsForOverlay,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  getLinkedClipGroupItemIds,
  quantizeDeltaUsToFrames,
  clampInt,
  quantizeRangeToFrames,
} from './utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';
import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionCurve, TransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

function assertClipNotLocked(item: TimelineTrackItem, action: string) {
  if (item.kind !== 'clip') return;
  if (!item.locked) return;
  throw new Error(`Locked clip: ${action}`);
}

export function addClipToTrack(
  doc: TimelineDocument,
  cmd: AddClipToTrackCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const fps = getDocFps(doc);
  const durationUs = quantizeTimeUsToFrames(Number(cmd.durationUs ?? 0), fps, 'round');
  const sourceDurationUs = Math.max(
    0,
    Math.round(Number(cmd.sourceDurationUs ?? cmd.durationUs ?? 0)),
  );
  const startCandidate =
    cmd.startUs === undefined ? computeTrackEndUs(track) : Math.max(0, Number(cmd.startUs));
  const startUs = quantizeTimeUsToFrames(startCandidate, fps, 'round');

  const clipType = cmd.clipType === 'timeline' ? 'timeline' : 'media';

  const clip: TimelineClipItem = {
    kind: 'clip',
    clipType,
    id: nextItemId(track.id, 'clip'),
    trackId: track.id,
    name: cmd.name,
    source: { path: cmd.path },
    sourceDurationUs,
    isImage: cmd.isImage,
    timelineRange: { startUs, durationUs },
    sourceRange: { startUs: 0, durationUs },
  };

  let nextTracks = doc.tracks;
  if (cmd.pseudo) {
    const sliced = sliceTrackItemsForOverlay(track.items, startUs, durationUs, fps, false);
    const nextItemsRaw = [...sliced, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  } else {
    assertNoOverlap(track, '', startUs, durationUs);
    const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  }

  return {
    next: {
      ...doc,
      tracks: nextTracks,
    },
  };
}

export function addVirtualClipToTrack(
  doc: TimelineDocument,
  cmd: AddVirtualClipToTrackCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const fps = getDocFps(doc);

  if (track.kind !== 'video') {
    throw new Error('Virtual clips can only be added to video tracks');
  }

  const durationUs = quantizeTimeUsToFrames(Number(cmd.durationUs ?? 5_000_000), fps, 'round');
  const startCandidate =
    cmd.startUs === undefined ? computeTrackEndUs(track) : Math.max(0, Number(cmd.startUs));
  const startUs = quantizeTimeUsToFrames(startCandidate, fps, 'round');

  const base: Omit<Extract<TimelineClipItem, { kind: 'clip' }>, 'clipType'> & {
    clipType: AddVirtualClipToTrackCommand['clipType'];
  } = {
    kind: 'clip',
    clipType: cmd.clipType,
    id: nextItemId(track.id, 'clip'),
    trackId: track.id,
    name: cmd.name,
    timelineRange: { startUs, durationUs },
    sourceRange: { startUs: 0, durationUs },
  };

  let clip: TimelineClipItem;
  switch (cmd.clipType) {
    case 'background':
      clip = {
        ...base,
        clipType: 'background',
        backgroundColor: sanitizeTimelineColor(cmd.backgroundColor, '#1a56db'),
      };
      break;
    case 'text':
      clip = {
        ...base,
        clipType: 'text',
        text: typeof cmd.text === 'string' ? cmd.text : 'Text',
        style: cmd.style,
      };
      break;
    case 'shape':
      clip = {
        ...base,
        clipType: 'shape',
        shapeType: cmd.shapeType ?? 'square',
        fillColor: '#ffffff',
      };
      break;
    case 'hud':
      clip = {
        ...base,
        clipType: 'hud',
        hudType: cmd.hudType ?? 'media_frame',
      };
      break;
    default:
      clip = {
        ...base,
        clipType: 'adjustment',
      };
      break;
  }

  let nextTracks = doc.tracks;
  if (cmd.pseudo) {
    const sliced = sliceTrackItemsForOverlay(track.items, startUs, durationUs, fps, false);
    const nextItemsRaw = [...sliced, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  } else {
    assertNoOverlap(track, '', startUs, durationUs);
    const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  }

  return {
    next: {
      ...doc,
      tracks: nextTracks,
    },
  };
}

export function renameItem(doc: TimelineDocument, cmd: RenameItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') throw new Error('Item not found or not a clip');
  if (item.name === cmd.name) return { next: doc };

  const nextTracks = doc.tracks.map((t) => {
    if (t.id === track.id) {
      return {
        ...t,
        items: t.items.map((it) =>
          it.id === cmd.itemId && it.kind === 'clip' ? { ...it, name: cmd.name } : it,
        ),
      };
    }
    return t;
  });
  return { next: { ...doc, tracks: nextTracks } };
}

/**
 * Pseudo-overlay trim: trims an item and then cuts/trims any clips that overlap
 * with the trimmed item's resulting range.
 */
export function overlayTrimItem(
  doc: TimelineDocument,
  cmd: OverlayTrimItemCommand,
): TimelineCommandResult {
  const fps = getDocFps(doc);

  const track = getTrackById(doc, cmd.trackId);
  const movedPrev = track.items.find((x) => x.id === cmd.itemId);
  if (!movedPrev || movedPrev.kind !== 'clip') return { next: doc };
  const moved = movedPrev as TimelineClipItem;

  assertClipNotLocked(moved, 'trim');

  if (moved.clipType === 'media' && moved.linkedVideoClipId && moved.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
  }

  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const deltaCandidate = Math.round(Number(cmd.deltaUs));
  const deltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;
  const speed = typeof moved.speed === 'number' && Number.isFinite(moved.speed) ? moved.speed : 1;
  const sourceDeltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * speed), fps, 'round')
    : Math.round(deltaUs * speed);

  const prevTimelineStartUs = Math.max(0, Math.round(moved.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(moved.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(moved.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(moved.sourceRange.durationUs));
  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  const hasFixedSourceDuration = moved.clipType === 'media' && !moved.isImage;
  const maxSourceDurationUs = hasFixedSourceDuration
    ? Math.max(0, Math.round(moved.sourceDurationUs))
    : Number.POSITIVE_INFINITY;

  const minSourceStartUs = hasFixedSourceDuration ? 0 : Number.NEGATIVE_INFINITY;
  const maxSourceEndUs = maxSourceDurationUs;

  let nextTimelineStartUs = prevTimelineStartUs;
  let nextTimelineDurationUs = prevTimelineDurationUs;
  let nextSourceStartUs = prevSourceStartUs;
  let nextSourceEndUs = prevSourceEndUs;

  if (cmd.edge === 'start') {
    const unclampedSourceStartUs = prevSourceStartUs + sourceDeltaUs;
    nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
    const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;

    const appliedTimelineDeltaUs = speed > 0 ? Math.round(appliedDeltaUs / speed) : 0;
    nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
    nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
    nextSourceEndUs = prevSourceEndUs;
  } else {
    const unclampedSourceEndUs = prevSourceEndUs + sourceDeltaUs;
    nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
    const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;

    const appliedTimelineDeltaUs = speed > 0 ? Math.round(appliedDeltaUs / speed) : 0;
    nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
    nextTimelineStartUs = prevTimelineStartUs;
    nextSourceStartUs = prevSourceStartUs;
  }

  const nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);
  if (shouldQuantizeToFrames) {
    const qTimeline = quantizeRangeToFrames(
      { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      fps,
    );
    nextTimelineStartUs = qTimeline.startUs;
    nextTimelineDurationUs = qTimeline.durationUs;
  }

  const movedNext: TimelineClipItem = {
    ...moved,
    timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
    sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
  };

  const startUs = movedNext.timelineRange.startUs;
  const durationUs = Math.max(0, movedNext.timelineRange.durationUs);
  const endUs = startUs + durationUs;

  const nextItems: TimelineTrackItem[] = [];
  for (const it of track.items) {
    if (it.id === moved.id) {
      nextItems.push(movedNext);
      continue;
    }
    if (it.kind !== 'clip') {
      nextItems.push(it);
      continue;
    }

    if (it.locked) {
      nextItems.push(it);
      continue;
    }

    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;

    if (itEnd <= startUs || itStart >= endUs) {
      nextItems.push(it);
      continue;
    }

    // Fully covered: delete
    if (itStart >= startUs && itEnd <= endUs) {
      continue;
    }

    // Overlaps only on the left side: trim end of existing clip
    if (itStart < startUs && itEnd > startUs && itEnd <= endUs) {
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startUs - itStart, fps, 'floor')
        : Math.max(0, Math.round(startUs - itStart));
      if (newDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: newDuration },
          sourceRange: { ...it.sourceRange, durationUs: newDuration },
        });
      }
      continue;
    }

    // Overlaps only on the right side: trim start of existing clip
    if (itStart >= startUs && itStart < endUs && itEnd > endUs) {
      const trimDelta = endUs - itStart;
      const newStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (newDuration > 0) {
        const newSourceStartUs = Math.min(
          it.sourceRange.startUs + trimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextItems.push({
          ...it,
          timelineRange: { startUs: newStart, durationUs: newDuration },
          sourceRange: {
            startUs: newSourceStartUs,
            durationUs: Math.max(0, it.sourceRange.durationUs - trimDelta),
          },
        });
      }
      continue;
    }

    // Existing clip fully contains the trimmed item range: split into two
    if (itStart < startUs && itEnd > endUs) {
      const leftDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startUs - itStart, fps, 'floor')
        : Math.max(0, Math.round(startUs - itStart));
      if (leftDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: leftDuration },
          sourceRange: { ...it.sourceRange, durationUs: leftDuration },
        });
      }

      const rightTrimDelta = endUs - itStart;
      const rightStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const rightDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (rightDuration > 0) {
        const rightSourceStartUs = Math.min(
          it.sourceRange.startUs + rightTrimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextItems.push({
          ...it,
          id: nextItemId(track.id, 'clip'),
          timelineRange: { startUs: rightStart, durationUs: rightDuration },
          sourceRange: {
            startUs: rightSourceStartUs,
            durationUs: Math.max(0, it.sourceRange.durationUs - rightTrimDelta),
          },
        });
      }
      continue;
    }

    nextItems.push(it);
  }

  nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const docWithMoved: TimelineDocument = {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t)),
  };
  const normalized = normalizeGaps(docWithMoved, track.id, nextItems, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: normalized } : t));

  if (track.kind === 'video' && movedNext.clipType === 'media') {
    const updatedMoved = findClipById({ ...doc, tracks: nextTracks }, movedNext.id);
    if (updatedMoved && updatedMoved.track.kind === 'video') {
      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        updatedMoved.item.id,
        (audio) => ({
          ...audio,
          timelineRange: {
            ...audio.timelineRange,
            startUs: updatedMoved.item.timelineRange.startUs,
            durationUs: updatedMoved.item.timelineRange.durationUs,
          },
          sourceRange: {
            ...audio.sourceRange,
            startUs: updatedMoved.item.sourceRange.startUs,
            durationUs: updatedMoved.item.sourceRange.durationUs,
          },
        }),
      );
    }
  }

  return { next: { ...doc, tracks: nextTracks } };
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
    effects: item.effects ? structuredClone(item.effects) : undefined,
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
    effects: item.effects ? structuredClone(item.effects) : undefined,
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
          const audioLocalCutUs = Math.max(0, Math.round((atUs - audioStartUs) * audioSpeed));

          const leftAudio: TimelineClipItem = {
            ...it,
            timelineRange: { startUs: audioStartUs, durationUs: leftAudioDurationUs },
            sourceRange: {
              startUs: it.sourceRange.startUs,
              durationUs: Math.max(0, audioLocalCutUs),
            },
            transitionOut: undefined,
            effects: it.effects ? structuredClone(it.effects) : undefined,
          };

          // TODO(keyframes): shift keyframes relative time in rightAudio's effects by audioLocalCutUs
          const rightAudio: TimelineClipItem = {
            ...it,
            id: nextItemId(t.id, 'clip'),
            trackId: t.id,
            timelineRange: { startUs: atUs, durationUs: rightAudioDurationUs },
            sourceRange: {
              startUs: Math.max(0, Math.round(it.sourceRange.startUs) + audioLocalCutUs),
              durationUs: Math.max(0, Math.round(it.sourceRange.durationUs) - audioLocalCutUs),
            },
            linkedGroupId: undefined,
            linkedVideoClipId: rightItemId,
            transitionIn: undefined,
            effects: it.effects ? structuredClone(it.effects) : undefined,
          };

          patched.push(leftAudio);
          patched.push(rightAudio);
        } else {
          patched.push(it);
        }
      }

      if (!changed) return t;
      patched.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return { ...t, items: normalizeGaps(doc, t.id, patched, { quantizeToFrames: false }) };
    });
  }

  return { next: { ...doc, tracks: nextTracks } };
}

export function updateClipProperties(
  doc: TimelineDocument,
  cmd: UpdateClipPropertiesCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  const nextProps: Record<string, unknown> = { ...cmd.properties };
  const fps = getDocFps(doc);

  function clampNumber(value: unknown, min: number, max: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(min, Math.min(max, n));
  }

  function sanitizeBlendMode(
    value: unknown,
  ): import('~/timeline/types').TimelineBlendMode | undefined {
    return value === 'add' ||
      value === 'multiply' ||
      value === 'screen' ||
      value === 'darken' ||
      value === 'lighten' ||
      value === 'normal'
      ? value
      : undefined;
  }

  function clampAudioFadeUs(value: unknown, maxUs: number): number | undefined {
    if (value === undefined) return undefined;
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
    return clampNumber(n, 0, Math.max(0, Math.round(maxUs)));
  }

  function sanitizeTransform(raw: unknown): import('~/timeline/types').ClipTransform | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const anyRaw = raw as any;

    const scaleRaw = anyRaw.scale;
    const scale =
      scaleRaw && typeof scaleRaw === 'object'
        ? {
            x: clampNumber(scaleRaw.x, -1000, 1000),
            y: clampNumber(scaleRaw.y, -1000, 1000),
            linked: scaleRaw.linked !== undefined ? Boolean(scaleRaw.linked) : undefined,
          }
        : undefined;

    const rotationDegRaw = anyRaw.rotationDeg;
    const rotationDeg =
      typeof rotationDegRaw === 'number' && Number.isFinite(rotationDegRaw)
        ? Math.max(-36000, Math.min(36000, rotationDegRaw))
        : undefined;

    const positionRaw = anyRaw.position;
    const position =
      positionRaw && typeof positionRaw === 'object'
        ? {
            x: clampNumber(positionRaw.x, -1_000_000, 1_000_000),
            y: clampNumber(positionRaw.y, -1_000_000, 1_000_000),
          }
        : undefined;

    const anchorRaw = anyRaw.anchor;
    const preset = anchorRaw && typeof anchorRaw === 'object' ? String(anchorRaw.preset ?? '') : '';
    const safePreset =
      preset === 'center' ||
      preset === 'topLeft' ||
      preset === 'topRight' ||
      preset === 'bottomLeft' ||
      preset === 'bottomRight' ||
      preset === 'custom'
        ? (preset as import('~/timeline/types').ClipAnchorPreset)
        : undefined;
    const anchor =
      safePreset !== undefined
        ? {
            preset: safePreset,
            x: safePreset === 'custom' ? clampNumber(anchorRaw.x, -10, 10) : undefined,
            y: safePreset === 'custom' ? clampNumber(anchorRaw.y, -10, 10) : undefined,
          }
        : undefined;

    if (!scale && rotationDeg === undefined && !position && !anchor) return undefined;
    return {
      scale,
      rotationDeg,
      position,
      anchor,
    };
  }

  if ('speed' in nextProps) {
    const raw = (nextProps as any).speed;
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const speed = v === undefined ? undefined : Math.max(-10, Math.min(10, v));
    if (speed === 0) {
      throw new Error('Speed cannot be 0');
    }
    if (speed === undefined) {
      delete nextProps.speed;
    } else {
      nextProps.speed = speed;
      const nextDurationUsRaw = Math.round(item.sourceRange.durationUs / Math.abs(speed));
      const nextDurationUs = Math.max(0, quantizeTimeUsToFrames(nextDurationUsRaw, fps, 'round'));
      const startUs = item.timelineRange.startUs;
      const prevDurationUs = Math.max(0, item.timelineRange.durationUs);

      const shouldTryRipple = nextDurationUs !== prevDurationUs;
      if (shouldTryRipple) {
        try {
          if (nextDurationUs > prevDurationUs) {
            assertNoOverlap(track, item.id, startUs, nextDurationUs);
          }
          nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
        } catch {
          // Exception means overlap occurred (or we want to explicitly ripple shift)
          const clips = track.items
            .filter((it): it is import('~/timeline/types').TimelineClipItem => it.kind === 'clip')
            .map((c) => ({ ...c, timelineRange: { ...c.timelineRange } }));
          clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

          const movedVideoClipIds: string[] = [];
          const nextClips = clips.map((c) => {
            if (c.id !== item.id) return c;
            return {
              ...c,
              speed,
              timelineRange: { ...c.timelineRange, durationUs: nextDurationUs },
            };
          });

          // Calculate how much the clips after this one should move
          const deltaUs = nextDurationUs - prevDurationUs;
          let foundCurrent = false;

          for (let i = 0; i < nextClips.length; i++) {
            const curr = nextClips[i];
            if (!curr) continue;

            if (curr.id === item.id) {
              foundCurrent = true;
              continue;
            }

            if (foundCurrent) {
              // Shift all subsequent clips by the duration delta
              const newStartUs = Math.max(0, curr.timelineRange.startUs + deltaUs);
              const qStartUs = quantizeTimeUsToFrames(newStartUs, fps, 'round');
              if (qStartUs !== curr.timelineRange.startUs) {
                nextClips[i] = {
                  ...curr,
                  timelineRange: { ...curr.timelineRange, startUs: qStartUs },
                };
                if (track.kind === 'video') {
                  movedVideoClipIds.push(curr.id);
                }
              }
            }
          }

          let nextTracksLocal = doc.tracks.map((t) =>
            t.id === track.id
              ? { ...t, items: normalizeGaps(doc, t.id, nextClips, { quantizeToFrames: false }) }
              : t,
          );

          for (const movedId of movedVideoClipIds) {
            const moved = nextClips.find((c) => c.id === movedId);
            if (!moved) continue;
            nextTracksLocal = updateLinkedLockedAudio(
              { ...doc, tracks: nextTracksLocal },
              movedId,
              (audio) => ({
                ...audio,
                timelineRange: { ...audio.timelineRange, startUs: moved.timelineRange.startUs },
              }),
            );
          }

          const updatedClip = nextClips.find((c) => c.id === item.id);
          if (updatedClip && track.kind === 'video' && updatedClip.clipType === 'media') {
            nextTracksLocal = updateLinkedLockedAudio(
              { ...doc, tracks: nextTracksLocal },
              updatedClip.id,
              (a) => ({
                ...a,
                timelineRange: {
                  ...a.timelineRange,
                  startUs: updatedClip.timelineRange.startUs,
                  durationUs: updatedClip.timelineRange.durationUs,
                },
                sourceRange: {
                  ...a.sourceRange,
                  startUs: updatedClip.sourceRange.startUs,
                  durationUs: updatedClip.sourceRange.durationUs,
                },
                sourceDurationUs: updatedClip.sourceDurationUs,
                speed: (updatedClip as any).speed,
              }),
            );
          }

          return { next: { ...doc, tracks: nextTracksLocal } };
        }
      } else {
        assertNoOverlap(track, item.id, startUs, nextDurationUs);
        nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
      }
    }
  }
  if ('backgroundColor' in nextProps) {
    if (item.clipType !== 'background') {
      delete nextProps.backgroundColor;
    } else {
      nextProps.backgroundColor = sanitizeTimelineColor(nextProps.backgroundColor, '#000000');
    }
  }

  if (item.clipType === 'shape') {
    if ('shapeType' in nextProps) {
      (nextProps as any).shapeType = nextProps.shapeType;
    }
    if ('fillColor' in nextProps) {
      (nextProps as any).fillColor =
        typeof nextProps.fillColor === 'string' ? nextProps.fillColor : undefined;
    }
    if ('strokeColor' in nextProps) {
      (nextProps as any).strokeColor =
        typeof nextProps.strokeColor === 'string' ? nextProps.strokeColor : undefined;
    }
    if ('strokeWidth' in nextProps) {
      (nextProps as any).strokeWidth =
        typeof nextProps.strokeWidth === 'number' ? nextProps.strokeWidth : undefined;
    }
    if ('shapeConfig' in nextProps) {
      (nextProps as any).shapeConfig = nextProps.shapeConfig;
    }
  }

  if (item.clipType === 'hud') {
    if ('hudType' in nextProps) {
      (nextProps as any).hudType = nextProps.hudType;
    }
    if ('background' in nextProps) {
      (nextProps as any).background = nextProps.background;
    }
    if ('content' in nextProps) {
      (nextProps as any).content = nextProps.content;
    }
  }

  if ('text' in nextProps) {
    if (item.clipType !== 'text') {
      delete (nextProps as any).text;
    } else {
      const raw = (nextProps as any).text;
      const safe = typeof raw === 'string' ? raw : '';
      (nextProps as any).text = safe;
    }
  }

  if ('style' in nextProps) {
    if (item.clipType !== 'text') {
      delete (nextProps as any).style;
    } else {
      const raw = (nextProps as any).style;
      if (!raw || typeof raw !== 'object') {
        delete (nextProps as any).style;
      } else {
        const anyRaw = raw as any;
        const fontFamily = typeof anyRaw.fontFamily === 'string' ? anyRaw.fontFamily : undefined;
        const widthRaw = anyRaw.width;
        const width =
          typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
            ? Math.max(1, Math.min(10_000, Math.round(widthRaw)))
            : undefined;
        const fontSizeRaw = anyRaw.fontSize;
        const fontSize =
          typeof fontSizeRaw === 'number' && Number.isFinite(fontSizeRaw)
            ? Math.max(1, Math.min(1000, Math.round(fontSizeRaw)))
            : undefined;
        const fontWeight =
          typeof anyRaw.fontWeight === 'string' || typeof anyRaw.fontWeight === 'number'
            ? anyRaw.fontWeight
            : undefined;
        const color = typeof anyRaw.color === 'string' ? anyRaw.color : undefined;
        const alignRaw = anyRaw.align;
        const align =
          alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right'
            ? alignRaw
            : undefined;

        const verticalAlignRaw = anyRaw.verticalAlign;
        const verticalAlign =
          verticalAlignRaw === 'top' ||
          verticalAlignRaw === 'middle' ||
          verticalAlignRaw === 'bottom'
            ? verticalAlignRaw
            : undefined;

        const lineHeightRaw = anyRaw.lineHeight;
        const lineHeight =
          typeof lineHeightRaw === 'number' && Number.isFinite(lineHeightRaw)
            ? Math.max(0.1, Math.min(10, lineHeightRaw))
            : undefined;

        const letterSpacingRaw = anyRaw.letterSpacing;
        const letterSpacing =
          typeof letterSpacingRaw === 'number' && Number.isFinite(letterSpacingRaw)
            ? Math.max(-1000, Math.min(1000, letterSpacingRaw))
            : undefined;

        const backgroundColor =
          typeof anyRaw.backgroundColor === 'string' ? anyRaw.backgroundColor.trim() : undefined;

        const paddingRaw = anyRaw.padding;
        const padding = (() => {
          const clampPadding = (v: unknown) =>
            typeof v === 'number' && Number.isFinite(v)
              ? Math.max(0, Math.min(10_000, v))
              : undefined;

          if (typeof paddingRaw === 'number') {
            const v = clampPadding(paddingRaw);
            return v === undefined ? undefined : { top: v, right: v, bottom: v, left: v };
          }
          if (!paddingRaw || typeof paddingRaw !== 'object') return undefined;

          const anyPad = paddingRaw as any;
          const x = clampPadding(anyPad.x);
          const y = clampPadding(anyPad.y);
          const top = clampPadding(anyPad.top);
          const right = clampPadding(anyPad.right);
          const bottom = clampPadding(anyPad.bottom);
          const left = clampPadding(anyPad.left);

          const fromXY =
            x !== undefined || y !== undefined
              ? {
                  top: y ?? 0,
                  right: x ?? 0,
                  bottom: y ?? 0,
                  left: x ?? 0,
                }
              : undefined;
          const fromEdges =
            top !== undefined || right !== undefined || bottom !== undefined || left !== undefined
              ? {
                  top: top ?? 0,
                  right: right ?? 0,
                  bottom: bottom ?? 0,
                  left: left ?? 0,
                }
              : undefined;

          const resolved = fromEdges ?? fromXY;
          if (!resolved) return undefined;
          if (
            resolved.top === 0 &&
            resolved.right === 0 &&
            resolved.bottom === 0 &&
            resolved.left === 0
          ) {
            return undefined;
          }
          return resolved;
        })();

        const safeStyle = {
          ...(fontFamily !== undefined ? { fontFamily } : {}),
          ...(width !== undefined ? { width } : {}),
          ...(fontSize !== undefined ? { fontSize } : {}),
          ...(fontWeight !== undefined ? { fontWeight } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(align !== undefined ? { align } : {}),
          ...(verticalAlign !== undefined ? { verticalAlign } : {}),
          ...(lineHeight !== undefined ? { lineHeight } : {}),
          ...(letterSpacing !== undefined ? { letterSpacing } : {}),
          ...(backgroundColor !== undefined && backgroundColor.length > 0
            ? { backgroundColor }
            : {}),
          ...(padding !== undefined ? { padding } : {}),
        };

        if (Object.keys(safeStyle).length === 0) {
          delete (nextProps as any).style;
        } else {
          (nextProps as any).style = safeStyle;
        }
      }
    }
  }

  if ('transform' in nextProps) {
    const safe = sanitizeTransform((nextProps as any).transform);
    if (safe === undefined) {
      delete nextProps.transform;
    } else {
      nextProps.transform = safe;
    }
  }

  if ('opacity' in nextProps) {
    const raw = (nextProps as any).opacity;
    const safe =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : undefined;
    if (safe === undefined) {
      delete (nextProps as any).opacity;
    } else {
      (nextProps as any).opacity = safe;
    }
  }

  if ('blendMode' in nextProps) {
    const safe = sanitizeBlendMode((nextProps as any).blendMode);
    if (safe === undefined) {
      delete (nextProps as any).blendMode;
    } else {
      (nextProps as any).blendMode = safe;
    }
  }

  if ('audioGain' in nextProps) {
    const raw = (nextProps as any).audioGain;
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const gain = v === undefined ? undefined : normalizeGain(v, 1);
    if (gain === undefined) {
      delete (nextProps as any).audioGain;
    } else {
      (nextProps as any).audioGain = gain;
    }
  }

  if ('audioBalance' in nextProps) {
    const raw = (nextProps as any).audioBalance;
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const balance = v === undefined ? undefined : normalizeBalance(v, 0);
    if (balance === undefined) {
      delete (nextProps as any).audioBalance;
    } else {
      (nextProps as any).audioBalance = balance;
    }
  }

  // Fade values are stored in timeline microseconds.
  // Clamp to the current clip duration to avoid invalid envelopes.
  if ('audioFadeInUs' in nextProps) {
    const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
    const oppFadeUs = Math.max(0, Math.round((item as any).audioFadeOutUs ?? 0));
    const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
    const safe = clampAudioFadeUs((nextProps as any).audioFadeInUs, maxUs);
    if (safe === undefined) {
      delete (nextProps as any).audioFadeInUs;
    } else {
      (nextProps as any).audioFadeInUs = safe;
    }
  }
  if ('audioFadeOutUs' in nextProps) {
    const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
    const oppFadeUs = Math.max(0, Math.round((item as any).audioFadeInUs ?? 0));
    const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
    const safe = clampAudioFadeUs((nextProps as any).audioFadeOutUs, maxUs);
    if (safe === undefined) {
      delete (nextProps as any).audioFadeOutUs;
    } else {
      (nextProps as any).audioFadeOutUs = safe;
    }
  }
  if ('audioFadeInCurve' in nextProps) {
    const raw = (nextProps as any).audioFadeInCurve;
    (nextProps as any).audioFadeInCurve = raw === 'logarithmic' ? 'logarithmic' : 'linear';
  }
  if ('audioFadeOutCurve' in nextProps) {
    const raw = (nextProps as any).audioFadeOutCurve;
    (nextProps as any).audioFadeOutCurve = raw === 'logarithmic' ? 'logarithmic' : 'linear';
  }

  const nextTracks = doc.tracks.map((t) => {
    if (t.id === track.id) {
      const updatedItems = t.items.map((it) =>
        it.id === cmd.itemId && it.kind === 'clip'
          ? (() => {
              const updated = { ...it, ...(nextProps as any) } as any;
              const durationUs = Math.max(0, Math.round(updated.timelineRange?.durationUs ?? 0));
              if (typeof updated.audioGain === 'number') {
                updated.audioGain = clampNumber(updated.audioGain, 0, 10);
              }
              if (typeof updated.audioBalance === 'number') {
                updated.audioBalance = clampNumber(updated.audioBalance, -1, 1);
              }
              if (typeof updated.audioFadeInUs === 'number') {
                updated.audioFadeInUs = clampNumber(
                  updated.audioFadeInUs,
                  0,
                  Math.max(0, durationUs - (Number(updated.audioFadeOutUs) || 0)),
                );
              }
              if (typeof updated.audioFadeOutUs === 'number') {
                updated.audioFadeOutUs = clampNumber(
                  updated.audioFadeOutUs,
                  0,
                  Math.max(0, durationUs - (Number(updated.audioFadeInUs) || 0)),
                );
              }
              if (updated.audioFadeInCurve !== undefined) {
                updated.audioFadeInCurve =
                  updated.audioFadeInCurve === 'logarithmic' ? 'logarithmic' : 'linear';
              }
              if (updated.audioFadeOutCurve !== undefined) {
                updated.audioFadeOutCurve =
                  updated.audioFadeOutCurve === 'logarithmic' ? 'logarithmic' : 'linear';
              }
              return updated;
            })()
          : it,
      );
      const normalized = normalizeGaps(doc, t.id, updatedItems, { quantizeToFrames: false });
      return { ...t, items: normalized };
    }
    return t;
  });

  let finalTracks = nextTracks;
  const updatedDoc = { ...doc, tracks: nextTracks };
  const updated = findClipById(updatedDoc, cmd.itemId);
  if (updated && updated.track.kind === 'video' && updated.item.clipType === 'media') {
    if ('timelineRange' in nextProps || 'speed' in nextProps) {
      finalTracks = updateLinkedLockedAudio(
        { ...doc, tracks: finalTracks },
        updated.item.id,
        (a) => ({
          ...a,
          timelineRange: {
            ...a.timelineRange,
            startUs: updated.item.timelineRange.startUs,
            durationUs: updated.item.timelineRange.durationUs,
          },
          sourceRange: {
            ...a.sourceRange,
            startUs: updated.item.sourceRange.startUs,
            durationUs: updated.item.sourceRange.durationUs,
          },
          speed: (updated.item as any).speed,
        }),
      );
    }

    if (
      'audioGain' in nextProps ||
      'audioBalance' in nextProps ||
      'audioFadeInUs' in nextProps ||
      'audioFadeOutUs' in nextProps ||
      'audioFadeInCurve' in nextProps ||
      'audioFadeOutCurve' in nextProps ||
      'audioMuted' in nextProps ||
      'audioWaveformMode' in nextProps ||
      'showWaveform' in nextProps
    ) {
      finalTracks = updateLinkedLockedAudio(
        { ...doc, tracks: finalTracks },
        updated.item.id,
        (a) => ({
          ...a,
          audioGain: (updated.item as any).audioGain,
          audioBalance: (updated.item as any).audioBalance,
          audioFadeInUs: (updated.item as any).audioFadeInUs,
          audioFadeOutUs: (updated.item as any).audioFadeOutUs,
          audioFadeInCurve: (updated.item as any).audioFadeInCurve,
          audioFadeOutCurve: (updated.item as any).audioFadeOutCurve,
          audioMuted: (updated.item as any).audioMuted,
          audioWaveformMode: (updated.item as any).audioWaveformMode,
          showWaveform: (updated.item as any).showWaveform,
        }),
      );
    }
  }

  return { next: { ...doc, tracks: finalTracks } };
}

export function removeItems(
  doc: TimelineDocument,
  cmd: RemoveItemCommand | DeleteItemsCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const idsToRemove = cmd.type === 'delete_items' ? cmd.itemIds : [cmd.itemId];

  let nextItems = [...track.items];
  let itemsRemoved = false;

  for (const itemId of idsToRemove) {
    const idx = nextItems.findIndex((x) => x.id === itemId);
    if (idx === -1) continue;

    const item = nextItems[idx];
    if (!item) continue;

    if (item.kind === 'clip' && item.locked && !cmd.ignoreLocks) {
      continue;
    }
    itemsRemoved = true;

    if (item.kind === 'clip') {
      nextItems.splice(idx, 1);
    } else if (item.kind === 'gap') {
      const gapDuration = item.timelineRange.durationUs;
      const gapEndUs = item.timelineRange.startUs + gapDuration;
      nextItems.splice(idx, 1);
      nextItems = nextItems.map((it) => {
        if (it.timelineRange.startUs >= gapEndUs) {
          return {
            ...it,
            timelineRange: {
              ...it.timelineRange,
              startUs: it.timelineRange.startUs - gapDuration,
            },
          };
        }
        return it;
      });
    }
  }

  if (!itemsRemoved) return { next: doc };

  nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  nextItems = normalizeGaps(doc, track.id, nextItems, { quantizeToFrames: false });

  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  return { next: { ...doc, tracks: nextTracks } };
}

export function moveItems(doc: TimelineDocument, cmd: MoveItemsCommand): TimelineCommandResult {
  let currentDoc = doc;

  for (const move of cmd.moves) {
    const res = moveItemToTrack(currentDoc, {
      type: 'move_item_to_track',
      fromTrackId: move.fromTrackId,
      toTrackId: move.toTrackId,
      itemId: move.itemId,
      startUs: move.startUs,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLinks: true,
    });
    currentDoc = res.next;
  }

  return { next: currentDoc };
}

export function moveItem(doc: TimelineDocument, cmd: MoveItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  if (!cmd.ignoreLinks && item.kind === 'clip') {
    const linkedIds = getLinkedClipGroupItemIds(doc, item.id).filter((id) => id !== item.id);
    if (linkedIds.length > 0) {
      const currentStartUs = Math.max(0, Math.round(Number(item.timelineRange.startUs)));
      const requestedStartUs = Math.max(0, Math.round(Number(cmd.startUs)));
      const deltaUs = requestedStartUs - currentStartUs;

      const moves: Array<{
        fromTrackId: string;
        toTrackId: string;
        itemId: string;
        startUs: number;
      }> = [];

      for (const track of doc.tracks) {
        for (const trackItem of track.items) {
          if (!linkedIds.includes(trackItem.id) && trackItem.id !== item.id) continue;
          moves.push({
            fromTrackId: track.id,
            toTrackId: track.id,
            itemId: trackItem.id,
            startUs: Math.max(0, Math.round(Number(trackItem.timelineRange.startUs)) + deltaUs),
          });
        }
      }

      if (moves.length > 1) {
        let currentDoc = doc;
        for (const move of moves) {
          const res = moveItemToTrack(currentDoc, {
            type: 'move_item_to_track',
            fromTrackId: move.fromTrackId,
            toTrackId: move.toTrackId,
            itemId: move.itemId,
            startUs: move.startUs,
            quantizeToFrames: cmd.quantizeToFrames,
            ignoreLocks: cmd.ignoreLocks,
            ignoreLinks: true,
          });
          currentDoc = res.next;
        }
        return { next: currentDoc };
      }
    }
  }

  if (
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId &&
    item.lockToLinkedVideo
  ) {
    const linked = findClipById(doc, item.linkedVideoClipId);
    if (!linked) return { next: doc };
    if (linked.track.kind !== 'video') return { next: doc };

    const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
    const startUs = shouldQuantizeToFrames
      ? quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round')
      : Math.max(0, Math.round(cmd.startUs));
    const durationUs = Math.max(0, linked.item.timelineRange.durationUs);

    assertNoOverlap(linked.track, linked.item.id, startUs, durationUs);

    let nextTracks = doc.tracks.map((t) => {
      if (t.id !== linked.track.id) return t;
      const nextItems: TimelineTrackItem[] = t.items.map((x) =>
        x.id === linked.item.id
          ? {
              ...x,
              timelineRange: { ...x.timelineRange, startUs },
            }
          : x,
      );
      nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return {
        ...t,
        items: normalizeGaps(doc, t.id, nextItems, {
          quantizeToFrames: shouldQuantizeToFrames,
        }),
      };
    });

    nextTracks = updateLinkedLockedAudio(
      { ...doc, tracks: nextTracks },
      linked.item.id,
      (audio) => ({
        ...audio,
        timelineRange: { ...audio.timelineRange, startUs },
      }),
    );

    return { next: { ...doc, tracks: nextTracks } };
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startUs)));
  const startUs = shouldQuantizeToFrames
    ? quantizeTimeUsToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationUs = Math.max(0, item.timelineRange.durationUs);

  assertNoOverlap(track, item.id, startUs, durationUs);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id
      ? {
          ...x,
          timelineRange: { ...x.timelineRange, startUs },
        }
      : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (!cmd.ignoreLinks && item.kind === 'clip' && track.kind === 'video') {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { ...audio.timelineRange, startUs },
    }));
  }

  return { next: { ...doc, tracks: nextTracks } };
}

export function moveItemToTrack(
  doc: TimelineDocument,
  cmd: MoveItemToTrackCommand,
): TimelineCommandResult {
  const fromTrack = getTrackById(doc, cmd.fromTrackId);
  const toTrack = getTrackById(doc, cmd.toTrackId);

  if (fromTrack.id === toTrack.id) {
    return moveItem(doc, {
      type: 'move_item',
      trackId: fromTrack.id,
      itemId: cmd.itemId,
      startUs: cmd.startUs,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLocks: cmd.ignoreLocks,
      ignoreLinks: cmd.ignoreLinks,
    });
  }

  const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
  if (itemIdx === -1) return { next: doc };
  const item = fromTrack.items[itemIdx];
  if (!item) return { next: doc };
  if (!item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  const isLockedLinkedAudio =
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    Boolean(item.linkedVideoClipId) &&
    Boolean(item.lockToLinkedVideo);

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startUs)));
  const startUs = shouldQuantizeToFrames
    ? quantizeTimeUsToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationUs = Math.max(0, item.timelineRange.durationUs);

  assertNoOverlap(toTrack, item.id, startUs, durationUs);

  const nextFromItemsRaw = [...fromTrack.items];
  nextFromItemsRaw.splice(itemIdx, 1);
  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startUs },
  };
  const nextToItemsRaw = [...toTrack.items, movedItem];
  nextToItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

  const nextFromItems = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });
  const nextToItems = normalizeGaps(doc, toTrack.id, nextToItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => {
    if (t.id === fromTrack.id) return { ...t, items: nextFromItems };
    if (t.id === toTrack.id) return { ...t, items: nextToItems };
    return t;
  });

  if (
    isLockedLinkedAudio &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId
  ) {
    const linked = findClipById({ ...doc, tracks: nextTracks }, item.linkedVideoClipId);
    if (linked && linked.track.kind === 'video') {
      const linkedDurationUs = Math.max(0, linked.item.timelineRange.durationUs);
      assertNoOverlap(linked.track, linked.item.id, startUs, linkedDurationUs);

      nextTracks = nextTracks.map((t) => {
        if (t.id !== linked.track.id) return t;
        const nextItems: TimelineTrackItem[] = t.items.map((x) =>
          x.id === linked.item.id
            ? {
                ...x,
                timelineRange: { ...x.timelineRange, startUs },
              }
            : x,
        );
        nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
        return {
          ...t,
          items: normalizeGaps(doc, t.id, nextItems, {
            quantizeToFrames: shouldQuantizeToFrames,
          }),
        };
      });

      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        linked.item.id,
        (audio) => ({
          ...audio,
          timelineRange: { ...audio.timelineRange, startUs },
        }),
      );
    }
  }

  return { next: { ...doc, tracks: nextTracks } };
}

export function trimItem(doc: TimelineDocument, cmd: TrimItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };
  if (item.kind !== 'clip') return { next: doc };

  assertClipNotLocked(item, 'trim');
  if (item.clipType === 'media' && item.linkedVideoClipId && item.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const deltaCandidate = Math.round(Number(cmd.deltaUs));
  const deltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const absSpeed = Math.abs(speed);
  const sourceDeltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * absSpeed), fps, 'round')
    : Math.round(deltaUs * absSpeed);

  const prevTimelineStartUs = Math.max(0, Math.round(item.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs));

  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  // For clips with fixed source duration (non-image media), use actual source limits.
  // For infinite-source clips (images, virtual clips), allow unlimited expansion.
  const hasFixedSourceDuration = item.clipType === 'media' && !item.isImage;
  const maxSourceDurationUs = hasFixedSourceDuration
    ? Math.max(0, Math.round(item.sourceDurationUs))
    : Number.POSITIVE_INFINITY;

  const minSourceStartUs = hasFixedSourceDuration ? 0 : Number.NEGATIVE_INFINITY;
  const maxSourceEndUs = maxSourceDurationUs;

  let nextTimelineStartUs = prevTimelineStartUs;
  let nextTimelineDurationUs = prevTimelineDurationUs;
  let nextSourceStartUs = prevSourceStartUs;
  let nextSourceEndUs = prevSourceEndUs;

  if (cmd.edge === 'start') {
    if (speed >= 0) {
      const unclampedSourceStartUs = prevSourceStartUs + sourceDeltaUs;
      nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
      const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
      nextSourceEndUs = prevSourceEndUs;
    } else {
      // Reversed: trim start of timeline means trim end of source range.
      const unclampedSourceEndUs = prevSourceEndUs - sourceDeltaUs;
      nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
      const appliedDeltaUs = prevSourceEndUs - nextSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
      nextSourceStartUs = prevSourceStartUs;
    }
  } else {
    if (speed >= 0) {
      const unclampedSourceEndUs = prevSourceEndUs + sourceDeltaUs;
      nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
      const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
      nextSourceStartUs = prevSourceStartUs;
    } else {
      // Reversed: trim end of timeline means trim start of source range.
      const unclampedSourceStartUs = prevSourceStartUs - sourceDeltaUs;
      nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
      const appliedDeltaUs = prevSourceStartUs - nextSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
      nextSourceEndUs = prevSourceEndUs;
    }
  }

  const nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);

  if (shouldQuantizeToFrames) {
    const qTimeline = quantizeRangeToFrames(
      { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      fps,
    );

    nextTimelineStartUs = qTimeline.startUs;
    nextTimelineDurationUs = qTimeline.durationUs;
  }

  assertNoOverlap(track, item.id, nextTimelineStartUs, nextTimelineDurationUs);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id
      ? {
          ...x,
          timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
          sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
        }
      : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (track.kind === 'video' && item.clipType === 'media') {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
      sourceDurationUs: item.sourceDurationUs,
    }));
  }

  return { next: { ...doc, tracks: nextTracks } };
}

export function updateClipTransition(
  doc: TimelineDocument,
  cmd: UpdateClipTransitionCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  const itemId = item.id;

  function coerceTransition(raw: any): {
    type: string;
    durationUs: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } | null {
    if (!raw) return null;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const durationUs = Number(raw.durationUs);
    if (!type) return null;
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
      return {
        type,
        durationUs: 0,
        mode: normalizeTransitionMode(raw.mode),
        curve: normalizeTransitionCurve(raw.curve),
        params: normalizeTransitionParams(type, raw.params) as Record<string, unknown> | undefined,
        isOverridden: raw.isOverridden,
      };
    }
    return {
      type,
      durationUs: Math.max(0, Math.round(durationUs)),
      mode: normalizeTransitionMode(raw.mode),
      curve: normalizeTransitionCurve(raw.curve),
      params: normalizeTransitionParams(type, raw.params) as Record<string, unknown> | undefined,
      isOverridden: raw.isOverridden,
    };
  }

  const patch: Record<string, unknown> = {};

  const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  function clampTransitionUs(input: {
    edge: 'in' | 'out';
    requested: {
      type: string;
      durationUs: number;
      mode: TransitionMode;
      curve: TransitionCurve;
      params?: Record<string, unknown>;
      isOverridden?: boolean;
    };
  }): {
    type: string;
    durationUs: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } {
    const maxUs = Math.max(0, clipDurationUs);
    return {
      ...input.requested,
      durationUs: Math.min(Math.max(0, Math.round(input.requested.durationUs)), maxUs),
    };
  }

  let requestedIn = 'transitionIn' in cmd ? coerceTransition(cmd.transitionIn) : undefined;
  if (requestedIn) {
    requestedIn = clampTransitionUs({
      edge: 'in',
      requested: requestedIn,
    });
  }

  let requestedOut = 'transitionOut' in cmd ? coerceTransition(cmd.transitionOut) : undefined;
  if (requestedOut) {
    requestedOut = clampTransitionUs({
      edge: 'out',
      requested: requestedOut,
    });
  }

  if ('transitionIn' in cmd) {
    patch.transitionIn = requestedIn ?? undefined;
  }
  if ('transitionOut' in cmd) {
    patch.transitionOut = requestedOut ?? undefined;
  }

  const nextTracks = doc.tracks.map((t) => {
    if (t.id !== track.id) return t;
    const nextItemsRaw = t.items.map((it) =>
      it.id === item.id ? ({ ...it, ...(patch as any) } as TimelineTrackItem) : it,
    );
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, t.id, nextItemsRaw, { quantizeToFrames: false });
    return { ...t, items: nextItems };
  });

  return { next: { ...doc, tracks: nextTracks } };
}

export function overlayPlaceItem(
  doc: TimelineDocument,
  cmd: OverlayPlaceItemCommand,
): TimelineCommandResult {
  const fromTrack = getTrackById(doc, cmd.fromTrackId);
  const toTrack = getTrackById(doc, cmd.toTrackId);

  const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
  if (itemIdx === -1) return { next: doc };
  const item = fromTrack.items[itemIdx];
  if (!item || !item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  const isLockedLinkedAudio =
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    Boolean(item.linkedVideoClipId) &&
    Boolean(item.lockToLinkedVideo);

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startUs)));
  const startUs = shouldQuantizeToFrames
    ? quantizeTimeUsToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationUs = Math.max(0, item.timelineRange.durationUs);
  const endUs = startUs + durationUs;

  const nextFromItemsRaw = fromTrack.items.filter((x) => x.id !== cmd.itemId);
  const isSameTrack = fromTrack.id === toTrack.id;
  const destItems: TimelineTrackItem[] = isSameTrack ? [...nextFromItemsRaw] : [...toTrack.items];

  const nextDestItems = sliceTrackItemsForOverlay(
    destItems,
    startUs,
    durationUs,
    fps,
    shouldQuantizeToFrames,
  );

  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startUs },
  };
  nextDestItems.push(movedItem);
  nextDestItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

  const normalizedDest = normalizeGaps(doc, toTrack.id, nextDestItems, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks: typeof doc.tracks;
  if (isSameTrack) {
    nextTracks = doc.tracks.map((t) => (t.id === toTrack.id ? { ...t, items: normalizedDest } : t));
  } else {
    const normalizedFrom = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw, {
      quantizeToFrames: shouldQuantizeToFrames,
    });
    nextTracks = doc.tracks.map((t) => {
      if (t.id === fromTrack.id) return { ...t, items: normalizedFrom };
      if (t.id === toTrack.id) return { ...t, items: normalizedDest };
      return t;
    });
  }

  if (
    isLockedLinkedAudio &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId
  ) {
    const linked = findClipById({ ...doc, tracks: nextTracks }, item.linkedVideoClipId);
    if (linked && linked.track.kind === 'video') {
      const linkedDurationUs = Math.max(0, linked.item.timelineRange.durationUs);
      assertNoOverlap(linked.track, linked.item.id, startUs, linkedDurationUs);

      nextTracks = nextTracks.map((t) => {
        if (t.id !== linked.track.id) return t;
        const nextItems: TimelineTrackItem[] = t.items.map((x) =>
          x.id === linked.item.id
            ? {
                ...x,
                timelineRange: { ...x.timelineRange, startUs },
              }
            : x,
        );
        nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
        return {
          ...t,
          items: normalizeGaps(doc, t.id, nextItems, {
            quantizeToFrames: shouldQuantizeToFrames,
          }),
        };
      });

      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        linked.item.id,
        (audio) => ({
          ...audio,
          timelineRange: { ...audio.timelineRange, startUs },
        }),
      );
    }
  } else if (
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    fromTrack.kind === 'video' &&
    toTrack.kind === 'video'
  ) {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { ...audio.timelineRange, startUs },
    }));
  }

  return { next: { ...doc, tracks: nextTracks } };
}
