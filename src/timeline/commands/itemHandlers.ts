import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../types';
import type {
  AddClipToTrackCommand,
  AddVirtualClipToTrackCommand,
  RemoveItemCommand,
  DeleteItemsCommand,
  MoveItemCommand,
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
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  quantizeDeltaUsToFrames,
  clampInt,
  quantizeRangeToFrames,
} from './utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';

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

  assertNoOverlap(track, '', startUs, durationUs);

  const clipType = cmd.clipType === 'timeline' ? 'timeline' : 'media';

  const clip: TimelineClipItem = {
    kind: 'clip',
    clipType,
    id: nextItemId(track.id, 'clip'),
    trackId: track.id,
    name: cmd.name,
    source: { path: cmd.path },
    sourceDurationUs,
    timelineRange: { startUs, durationUs },
    sourceRange: { startUs: 0, durationUs },
  };

  const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

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

  assertNoOverlap(track, '', startUs, durationUs);

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

  const clip: TimelineClipItem =
    cmd.clipType === 'background'
      ? {
          ...base,
          clipType: 'background',
          backgroundColor: cmd.backgroundColor ?? '#1a56db',
        }
      : cmd.clipType === 'text'
        ? {
            ...base,
            clipType: 'text',
            text: typeof cmd.text === 'string' ? cmd.text : 'Text',
            style: cmd.style,
          }
        : {
            ...base,
            clipType: 'adjustment',
          };

  const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);
  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

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

  const deltaUs = quantizeDeltaUsToFrames(Number(cmd.deltaUs), fps, 'round');
  const speed = typeof moved.speed === 'number' && Number.isFinite(moved.speed) ? moved.speed : 1;
  const sourceDeltaUs = quantizeDeltaUsToFrames(Math.round(deltaUs * speed), fps, 'round');

  const prevTimelineStartUs = Math.max(0, Math.round(moved.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(moved.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(moved.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(moved.sourceRange.durationUs));
  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  const maxSourceDurationUs =
    moved.clipType === 'media'
      ? Math.max(0, Math.round(moved.sourceDurationUs))
      : Number.POSITIVE_INFINITY;

  const minSourceStartUs = 0;
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
  const qTimeline = quantizeRangeToFrames(
    { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
    fps,
  );
  nextTimelineStartUs = qTimeline.startUs;
  nextTimelineDurationUs = qTimeline.durationUs;

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
      const newDuration = quantizeTimeUsToFrames(startUs - itStart, fps, 'floor');
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
      const newStart = quantizeTimeUsToFrames(endUs, fps, 'ceil');
      const newDuration = quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor');
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
      const leftDuration = quantizeTimeUsToFrames(startUs - itStart, fps, 'floor');
      if (leftDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: leftDuration },
          sourceRange: { ...it.sourceRange, durationUs: leftDuration },
        });
      }

      const rightTrimDelta = endUs - itStart;
      const rightStart = quantizeTimeUsToFrames(endUs, fps, 'ceil');
      const rightDuration = quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor');
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
  const normalized = normalizeGaps(docWithMoved, track.id, nextItems);

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

  assertClipNotLocked(item, 'split');

  if (item.clipType === 'media' && item.linkedVideoClipId && item.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
  }

  const fps = getDocFps(doc);
  const qTimeline = quantizeRangeToFrames(item.timelineRange, fps);
  const startUs = qTimeline.startUs;
  const endUs = startUs + qTimeline.durationUs;

  const startFrame = usToFrame(startUs, fps, 'round');
  const endFrame = usToFrame(endUs, fps, 'round');
  const cutFrame = usToFrame(quantizeTimeUsToFrames(Number(cmd.atUs), fps, 'round'), fps, 'round');

  if (!(cutFrame > startFrame && cutFrame < endFrame)) {
    return { next: doc };
  }

  const atUs = frameToUs(cutFrame, fps);

  const leftDurationUs = Math.max(0, atUs - startUs);
  const rightDurationUs = Math.max(0, endUs - atUs);
  if (leftDurationUs <= 0 || rightDurationUs <= 0) return { next: doc };

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const localCutUs = Math.max(0, Math.round((atUs - startUs) * speed));
  const leftSourceDurationUs = Math.max(0, localCutUs);
  const rightSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs) + localCutUs);
  const rightSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs) - localCutUs);

  const rightItemId = nextItemId(track.id, 'clip');

  const leftPatched: TimelineClipItem = {
    ...(item as TimelineClipItem),
    timelineRange: { startUs, durationUs: leftDurationUs },
    sourceRange: { startUs: item.sourceRange.startUs, durationUs: leftSourceDurationUs },
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
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

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
            linkedVideoClipId: rightItemId,
            timelineRange: { startUs: atUs, durationUs: rightAudioDurationUs },
            sourceRange: {
              startUs: Math.max(0, Math.round(it.sourceRange.startUs) + audioLocalCutUs),
              durationUs: Math.max(0, Math.round(it.sourceRange.durationUs) - audioLocalCutUs),
            },
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
      return { ...t, items: normalizeGaps(doc, t.id, patched) };
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
    const speed = v === undefined ? undefined : Math.max(0.1, Math.min(10, v));
    if (speed === undefined) {
      delete nextProps.speed;
    } else {
      nextProps.speed = speed;
      const nextDurationUsRaw = Math.round(item.sourceRange.durationUs / speed);
      const nextDurationUs = Math.max(0, quantizeTimeUsToFrames(nextDurationUsRaw, fps, 'round'));
      const startUs = item.timelineRange.startUs;
      const prevDurationUs = Math.max(0, item.timelineRange.durationUs);

      const shouldTryRipple = nextDurationUs > prevDurationUs;
      if (shouldTryRipple) {
        try {
          assertNoOverlap(track, item.id, startUs, nextDurationUs);
          nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
        } catch {
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

          for (let i = 0; i < nextClips.length; i++) {
            const curr = nextClips[i];
            if (!curr) continue;
            const prev = i > 0 ? nextClips[i - 1] : null;
            if (!prev) continue;

            const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
            const currStartUs = curr.timelineRange.startUs;
            if (currStartUs < prevEndUs) {
              const qStartUs = quantizeTimeUsToFrames(prevEndUs, fps, 'round');
              if (qStartUs !== currStartUs) {
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
            t.id === track.id ? { ...t, items: normalizeGaps(doc, t.id, nextClips) } : t,
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
      const raw = nextProps.backgroundColor;
      const value = typeof raw === 'string' ? raw.trim() : '';
      nextProps.backgroundColor = value.length > 0 ? value : '#000000';
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
              return updated;
            })()
          : it,
      );
      const normalized = normalizeGaps(doc, t.id, updatedItems);
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
      'audioFadeOutUs' in nextProps
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

    if (item.kind === 'clip' && item.locked) {
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
  nextItems = normalizeGaps(doc, track.id, nextItems);

  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  return { next: { ...doc, tracks: nextTracks } };
}

export function moveItem(doc: TimelineDocument, cmd: MoveItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };

  assertClipNotLocked(item, 'move');

  if (
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId &&
    item.lockToLinkedVideo
  ) {
    const linked = findClipById(doc, item.linkedVideoClipId);
    if (!linked) return { next: doc };
    if (linked.track.kind !== 'video') return { next: doc };

    const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
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
      return { ...t, items: normalizeGaps(doc, t.id, nextItems) };
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

  const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
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
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (item.kind === 'clip' && track.kind === 'video') {
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
    });
  }

  const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
  if (itemIdx === -1) return { next: doc };
  const item = fromTrack.items[itemIdx];
  if (!item) return { next: doc };
  if (!item.timelineRange) return { next: doc };

  assertClipNotLocked(item, 'move');
  const isLockedLinkedAudio =
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    Boolean(item.linkedVideoClipId) &&
    Boolean(item.lockToLinkedVideo);

  const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
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

  const nextFromItems = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw);
  const nextToItems = normalizeGaps(doc, toTrack.id, nextToItemsRaw);

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
        return { ...t, items: normalizeGaps(doc, t.id, nextItems) };
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
  const deltaUs = quantizeDeltaUsToFrames(Number(cmd.deltaUs), fps, 'round');

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const sourceDeltaUs = quantizeDeltaUsToFrames(Math.round(deltaUs * speed), fps, 'round');

  const prevTimelineStartUs = Math.max(0, Math.round(item.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs));

  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;
  const maxSourceDurationUs =
    item.clipType === 'media'
      ? Math.max(0, Math.round(item.sourceDurationUs))
      : Number.POSITIVE_INFINITY;

  const minSourceStartUs = 0;
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

  const qTimeline = quantizeRangeToFrames(
    { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
    fps,
  );

  nextTimelineStartUs = qTimeline.startUs;
  nextTimelineDurationUs = qTimeline.durationUs;

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
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

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

  const fps = getDocFps(doc);

  function coerceTransition(
    raw: any,
  ): { type: string; durationUs: number; mode?: any; curve?: any } | null {
    if (!raw) return null;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const durationUs = Number(raw.durationUs);
    if (!type) return null;
    if (!Number.isFinite(durationUs) || durationUs <= 0) return { type, durationUs: 0 };
    return {
      type,
      durationUs: Math.max(0, Math.round(durationUs)),
      mode: raw.mode,
      curve: raw.curve,
    };
  }

  function findAdjacentClips() {
    const clips = track.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .map((c) => ({
        ...c,
        timelineRange: { ...c.timelineRange },
        sourceRange: { ...c.sourceRange },
      }));
    clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const idx = clips.findIndex((c) => c.id === itemId);
    if (idx === -1) return null;
    const curr = clips[idx];
    if (!curr) return null;
    return {
      ordered: clips,
      index: idx,
      prev: idx > 0 ? (clips[idx - 1] ?? null) : null,
      curr,
      next: idx < clips.length - 1 ? (clips[idx + 1] ?? null) : null,
    };
  }

  function computeAllowedOverlapUs(params: {
    left: TimelineClipItem;
    right: TimelineClipItem;
    requestedUs: number;
  }): number {
    const requestedUs = Math.max(0, Math.round(params.requestedUs));
    if (requestedUs <= 0) return 0;

    const left = params.left;
    const right = params.right;

    const existingOverlapUs = getCutOverlapUs(left, right);

    const leftSourceEndUs = left.sourceRange.startUs + left.sourceRange.durationUs;
    const leftMaxEndUs =
      left.clipType === 'media'
        ? Math.max(0, Math.round(left.sourceDurationUs))
        : Number.POSITIVE_INFINITY;
    const leftTailHandleUs = Number.isFinite(leftMaxEndUs)
      ? Math.max(0, leftMaxEndUs - leftSourceEndUs)
      : requestedUs;

    const leftTotalAvailableOverlapUs = Number.isFinite(leftMaxEndUs)
      ? Math.max(0, existingOverlapUs + leftTailHandleUs)
      : requestedUs;

    const overlapUs = Math.min(
      requestedUs,
      leftTotalAvailableOverlapUs,
      Math.max(
        0,
        Math.round(left.timelineRange.durationUs) - ((left as any).transitionIn?.durationUs ?? 0),
      ),
      Math.max(
        0,
        Math.round(right.timelineRange.durationUs) -
          ((right as any).transitionOut?.durationUs ?? 0),
      ),
    );
    return quantizeDeltaUsToFrames(overlapUs, fps, 'floor');
  }

  function getCutOverlapUs(left: TimelineClipItem, right: TimelineClipItem): number {
    const leftEnd = left.timelineRange.startUs + left.timelineRange.durationUs;
    const rightStart = right.timelineRange.startUs;
    return Math.max(0, Math.round(leftEnd - rightStart));
  }

  function applyCutOverlap(params: {
    left: TimelineClipItem;
    right: TimelineClipItem;
    desiredOverlapUs: number;
  }): { left: TimelineClipItem; right: TimelineClipItem } {
    const desiredOverlapUs = Math.max(0, Math.round(params.desiredOverlapUs));
    const currentOverlapUs = getCutOverlapUs(params.left, params.right);
    const deltaUs = desiredOverlapUs - currentOverlapUs;
    if (deltaUs === 0) return { left: params.left, right: params.right };

    const left = params.left;

    const nextLeftDurationUs = Math.max(0, Math.round(left.timelineRange.durationUs) + deltaUs);
    const nextLeftSourceDurationUs = Math.max(0, Math.round(left.sourceRange.durationUs) + deltaUs);

    const leftNext: TimelineClipItem = {
      ...left,
      timelineRange: {
        ...left.timelineRange,
        durationUs: nextLeftDurationUs,
      },
      sourceRange: {
        ...left.sourceRange,
        durationUs: nextLeftSourceDurationUs,
      },
    };

    return { left: leftNext, right: params.right };
  }

  const patch: Record<string, unknown> = {};

  const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  function clampTransitionUs(input: {
    edge: 'in' | 'out';
    requested: { type: string; durationUs: number; mode?: any; curve?: any };
  }): { type: string; durationUs: number; mode?: any; curve?: any } {
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

  if ('transitionIn' in cmd && 'transitionOut' in cmd && requestedIn && requestedOut) {
    const maxOutUs = Math.max(0, clipDurationUs - requestedIn.durationUs);
    if (requestedOut.durationUs > maxOutUs) {
      requestedOut = { ...requestedOut, durationUs: maxOutUs };
    }
  }

  // If we are setting one edge and the opposite edge exists, ensure they fit exactly.
  // When the requested edge grows and would hit the opposite transition, we reduce the opposite.
  if ('transitionIn' in cmd && requestedIn && (item as any).transitionOut) {
    const out = (item as any).transitionOut;
    const maxOppUs = Math.max(0, clipDurationUs - requestedIn.durationUs);
    const nextOppUs = Math.min(Math.max(0, Math.round(out.durationUs ?? 0)), maxOppUs);
    if (nextOppUs !== out.durationUs) {
      patch.transitionOut = nextOppUs <= 0 ? undefined : { ...out, durationUs: nextOppUs };
    }
  }
  if ('transitionOut' in cmd && requestedOut && (item as any).transitionIn) {
    const inn = (item as any).transitionIn;
    const maxOppUs = Math.max(0, clipDurationUs - requestedOut.durationUs);
    const nextOppUs = Math.min(Math.max(0, Math.round(inn.durationUs ?? 0)), maxOppUs);
    if (nextOppUs !== inn.durationUs) {
      patch.transitionIn = nextOppUs <= 0 ? undefined : { ...inn, durationUs: nextOppUs };
    }
  }

  if ('transitionIn' in cmd) {
    patch.transitionIn = requestedIn ?? undefined;
  }
  if ('transitionOut' in cmd) {
    patch.transitionOut = requestedOut ?? undefined;
  }

  const adjacent = findAdjacentClips();

  const patchedItemsById = new Map<string, TimelineTrackItem>();
  patchedItemsById.set(item.id, { ...item, ...(patch as any) } as any);

  // Auto-overlap when applying a transition on a cut between adjacent clips.
  // Strategy:
  // - If setting transitionOut on current and there is an adjacent next clip starting at current end,
  //   try to overlap them by requested duration (bounded by source handles), and mirror transitionIn on next.
  // - If setting transitionIn on current and there is an adjacent prev clip ending at current start,
  //   do the same with prev/current and mirror transitionOut on prev.
  function patchCut(params: {
    left: TimelineClipItem;
    right: TimelineClipItem;
    requested: { type: string; durationUs: number; mode?: any; curve?: any } | null;
    clear: boolean;
  }) {
    const leftEndUs = params.left.timelineRange.startUs + params.left.timelineRange.durationUs;
    const rightStartUs = params.right.timelineRange.startUs;
    const gapUs = Math.max(0, Math.round(rightStartUs - leftEndUs));
    const existingOverlapUs = getCutOverlapUs(params.left, params.right);

    // Do not auto-stretch across a positive gap. We only support overlap on a cut (adjacent)
    // or when overlap already exists.
    const isNearCut = gapUs <= 1_000;
    if (!isNearCut && existingOverlapUs === 0) {
      return;
    }

    if (params.clear || !params.requested || params.requested.durationUs <= 0) {
      if (existingOverlapUs > 0) {
        const { left } = applyCutOverlap({
          left: params.left,
          right: params.right,
          desiredOverlapUs: 0,
        });
        patchedItemsById.set(left.id, {
          ...left,
          transitionOut: undefined,
        } as any);
      } else {
        patchedItemsById.set(params.left.id, {
          ...params.left,
          transitionOut: undefined,
        } as any);
      }

      patchedItemsById.set(params.right.id, {
        ...params.right,
        transitionIn: undefined,
      } as any);
      return;
    }

    const allowedOverlapUs = computeAllowedOverlapUs({
      left: params.left,
      right: params.right,
      requestedUs: params.requested.durationUs,
    });

    const { left, right } = applyCutOverlap({
      left: params.left,
      right: params.right,
      desiredOverlapUs: allowedOverlapUs,
    });

    patchedItemsById.set(left.id, {
      ...left,
      transitionOut: {
        type: params.requested.type,
        durationUs: allowedOverlapUs,
        mode: params.requested.mode,
        curve: params.requested.curve,
      },
    } as any);
    patchedItemsById.set(right.id, {
      ...right,
      transitionIn: {
        type: params.requested.type,
        durationUs: allowedOverlapUs,
        mode: params.requested.mode,
        curve: params.requested.curve,
      },
    } as any);
  }

  if (adjacent) {
    const curr = adjacent.curr;
    const currStartUs = curr.timelineRange.startUs;
    const currEndUs = currStartUs + curr.timelineRange.durationUs;

    const prev = adjacent.prev;
    const next = adjacent.next;

    if ('transitionOut' in cmd && next) {
      patchCut({
        left: curr,
        right: next,
        requested: requestedOut ?? null,
        clear: cmd.transitionOut === null,
      });
    }

    if ('transitionIn' in cmd && prev) {
      patchCut({
        left: prev,
        right: curr,
        requested: requestedIn ?? null,
        clear: cmd.transitionIn === null,
      });
    }
  }

  const nextTracks = doc.tracks.map((t) => {
    if (t.id !== track.id) return t;
    const nextItemsRaw = t.items.map((it) => patchedItemsById.get(it.id) ?? it);
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, t.id, nextItemsRaw);
    return { ...t, items: nextItems };
  });

  let finalTracks = nextTracks;
  // If we changed a video media clip timing, keep linked locked audio in sync.
  // We update for any patched item id that represents a video media clip.
  const updatedDoc = { ...doc, tracks: nextTracks };
  for (const updated of patchedItemsById.values()) {
    if (!updated || updated.kind !== 'clip') continue;
    if (updated.clipType !== 'media') continue;
    const resolved = findClipById(updatedDoc, updated.id);
    if (!resolved || resolved.track.kind !== 'video') continue;

    finalTracks = updateLinkedLockedAudio({ ...doc, tracks: finalTracks }, updated.id, (audio) => ({
      ...audio,
      timelineRange: {
        ...audio.timelineRange,
        startUs: updated.timelineRange.startUs,
        durationUs: updated.timelineRange.durationUs,
      },
      sourceRange: {
        ...audio.sourceRange,
        startUs: updated.sourceRange.startUs,
        durationUs: updated.sourceRange.durationUs,
      },
      sourceDurationUs: updated.sourceDurationUs,
    }));
  }

  return { next: { ...doc, tracks: finalTracks } };
}

/**
 * Pseudo-overlay placement: places an item on the track at startUs,
 * trimming or deleting any clips that overlap with the placed item's range.
 * Clips fully covered are removed; partially covered clips are trimmed.
 */
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

  assertClipNotLocked(item, 'move');

  const fps = getDocFps(doc);
  const startUs = quantizeTimeUsToFrames(cmd.startUs, fps, 'round');
  const durationUs = Math.max(0, item.timelineRange.durationUs);
  const endUs = startUs + durationUs;

  const nextFromItemsRaw = fromTrack.items.filter((x) => x.id !== cmd.itemId);
  const isSameTrack = fromTrack.id === toTrack.id;
  const destItems: TimelineTrackItem[] = isSameTrack ? [...nextFromItemsRaw] : [...toTrack.items];

  const nextDestItems: TimelineTrackItem[] = [];
  for (const it of destItems) {
    if (it.kind !== 'clip') {
      nextDestItems.push(it);
      continue;
    }

    if (it.locked) {
      const itStartLocked = it.timelineRange.startUs;
      const itEndLocked = itStartLocked + it.timelineRange.durationUs;
      const overlapsLocked = itEndLocked > startUs && itStartLocked < endUs;
      if (overlapsLocked) {
        throw new Error('Locked clip');
      }
      nextDestItems.push(it);
      continue;
    }

    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;

    if (itEnd <= startUs || itStart >= endUs) {
      nextDestItems.push(it);
      continue;
    }

    // Fully covered: delete
    if (itStart >= startUs && itEnd <= endUs) {
      continue;
    }

    // Overlaps only on the left side: trim end of existing clip
    if (itStart < startUs && itEnd > startUs && itEnd <= endUs) {
      const newDuration = quantizeTimeUsToFrames(startUs - itStart, fps, 'floor');
      if (newDuration > 0) {
        nextDestItems.push({
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
      const newStart = quantizeTimeUsToFrames(endUs, fps, 'ceil');
      const newDuration = quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor');
      if (newDuration > 0) {
        const newSourceStartUs = Math.min(
          it.sourceRange.startUs + trimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextDestItems.push({
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

    // Existing clip fully contains the new item: split into two
    if (itStart < startUs && itEnd > endUs) {
      const leftDuration = quantizeTimeUsToFrames(startUs - itStart, fps, 'floor');
      if (leftDuration > 0) {
        nextDestItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: leftDuration },
          sourceRange: { ...it.sourceRange, durationUs: leftDuration },
        });
      }
      const rightTrimDelta = endUs - itStart;
      const rightStart = quantizeTimeUsToFrames(endUs, fps, 'ceil');
      const rightDuration = quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor');
      if (rightDuration > 0) {
        const rightSourceStartUs = Math.min(
          it.sourceRange.startUs + rightTrimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextDestItems.push({
          ...it,
          id: nextItemId(toTrack.id, 'clip'),
          timelineRange: { startUs: rightStart, durationUs: rightDuration },
          sourceRange: {
            startUs: rightSourceStartUs,
            durationUs: Math.max(0, it.sourceRange.durationUs - rightTrimDelta),
          },
        });
      }
      continue;
    }

    nextDestItems.push(it);
  }

  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startUs },
  };
  nextDestItems.push(movedItem);
  nextDestItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

  const normalizedDest = normalizeGaps(doc, toTrack.id, nextDestItems);

  let nextTracks: typeof doc.tracks;
  if (isSameTrack) {
    nextTracks = doc.tracks.map((t) => (t.id === toTrack.id ? { ...t, items: normalizedDest } : t));
  } else {
    const normalizedFrom = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw);
    nextTracks = doc.tracks.map((t) => {
      if (t.id === fromTrack.id) return { ...t, items: normalizedFrom };
      if (t.id === toTrack.id) return { ...t, items: normalizedDest };
      return t;
    });
  }

  return { next: { ...doc, tracks: nextTracks } };
}
