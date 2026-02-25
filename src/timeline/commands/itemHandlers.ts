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

export function splitItem(doc: TimelineDocument, cmd: SplitItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

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
      assertNoOverlap(track, item.id, item.timelineRange.startUs, nextDurationUs);
      nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
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

  const nextTracks = doc.tracks.map((t) => {
    if (t.id === track.id) {
      return {
        ...t,
        items: t.items.map((it) =>
          it.id === cmd.itemId && it.kind === 'clip' ? { ...it, ...(nextProps as any) } : it,
        ),
      };
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
          sourceDurationUs: updated.item.sourceDurationUs,
          speed: (updated.item as any).speed,
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

    const leftSourceEndUs = left.sourceRange.startUs + left.sourceRange.durationUs;
    const leftMaxEndUs =
      left.clipType === 'media'
        ? Math.max(0, Math.round(left.sourceDurationUs))
        : Number.POSITIVE_INFINITY;
    const leftTailHandleUs = Number.isFinite(leftMaxEndUs)
      ? Math.max(0, leftMaxEndUs - leftSourceEndUs)
      : requestedUs;

    const overlapUs = Math.min(
      requestedUs,
      leftTailHandleUs,
      Math.max(0, Math.round(left.timelineRange.durationUs)),
      Math.max(0, Math.round(right.timelineRange.durationUs)),
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
  if ('transitionIn' in cmd) {
    patch.transitionIn = cmd.transitionIn ?? undefined;
  }
  if ('transitionOut' in cmd) {
    patch.transitionOut = cmd.transitionOut ?? undefined;
  }

  const adjacent = findAdjacentClips();
  const requestedIn = 'transitionIn' in cmd ? coerceTransition(cmd.transitionIn) : null;
  const requestedOut = 'transitionOut' in cmd ? coerceTransition(cmd.transitionOut) : null;

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
        requested: requestedOut,
        clear: cmd.transitionOut === null,
      });
    }

    if ('transitionIn' in cmd && prev) {
      patchCut({
        left: prev,
        right: curr,
        requested: requestedIn,
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
