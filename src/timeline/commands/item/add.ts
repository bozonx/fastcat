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
} from '../utils';
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
