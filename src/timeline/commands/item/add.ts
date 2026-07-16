import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  AddClipToTrackCommand,
  AddVirtualClipToTrackCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTicksToFrames,
  computeTrackEndTicks,
  assertNoOverlap,
  nextItemId,
  sliceTrackItemsForOverlay,
  normalizeGaps,
} from '../utils';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import { TICKS_PER_SECOND } from '~/utils/time';

export function addClipToTrack(
  doc: TimelineDocument,
  cmd: AddClipToTrackCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const durationTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(Number(cmd.durationTicks ?? 0), fps, 'round')
    : Math.max(0, Math.round(Number(cmd.durationTicks ?? 0)));
  const sourceDurationTicks =
    cmd.sourceDurationTicks !== undefined
      ? Math.max(0, Math.round(Number(cmd.sourceDurationTicks)))
      : Math.max(0, Math.round(Number(cmd.durationTicks ?? 0)));
  const sourceRangeStartTicks = Math.max(0, Math.round(Number(cmd.sourceRange?.startTicks ?? 0)));
  const requestedSourceRangeDurationTicks = Math.max(
    0,
    Math.round(Number(cmd.sourceRange?.durationTicks ?? durationTicks)),
  );
  const maxSourceRangeDurationTicks =
    sourceDurationTicks > 0
      ? Math.max(0, sourceDurationTicks - Math.min(sourceRangeStartTicks, sourceDurationTicks))
      : requestedSourceRangeDurationTicks;
  const sourceRange = {
    startTicks:
      sourceDurationTicks > 0
        ? Math.min(sourceRangeStartTicks, sourceDurationTicks)
        : sourceRangeStartTicks,
    durationTicks: Math.min(requestedSourceRangeDurationTicks, maxSourceRangeDurationTicks),
  };
  const startCandidate =
    cmd.startTicks === undefined
      ? computeTrackEndTicks(track)
      : Math.max(0, Number(cmd.startTicks));
  const startTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(startCandidate, fps, 'round')
    : Math.max(0, Math.round(startCandidate));

  const clipType = cmd.path.toLowerCase().endsWith('.otio') ? 'timeline' : 'media';

  const clip: TimelineClipItem = {
    kind: 'clip',
    clipType,
    id: cmd.clipId || nextItemId(track.id, 'clip'),
    name: cmd.name,
    trackId: cmd.trackId,
    source: { path: cmd.path },
    sourceDurationTicks,
    isImage: cmd.isImage,
    timelineRange: { startTicks, durationTicks },
    sourceRange,
    audioFadeInCurve: cmd.audioFadeInCurve,
    audioFadeOutCurve: cmd.audioFadeOutCurve,
    showWaveform: cmd.showWaveform,
    audioWaveformMode: cmd.audioWaveformMode,
  };

  let nextTracks = doc.tracks;
  if (cmd.pseudo) {
    const sliced = sliceTrackItemsForOverlay(track.items, startTicks, durationTicks, fps, false);
    const nextItemsRaw = [...sliced, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  } else {
    assertNoOverlap(track, '', startTicks, durationTicks);
    const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  }

  return {
    next: {
      ...doc,
      tracks: nextTracks,
    },
    createdItemIds: [clip.id],
  };
}

export function addVirtualClipToTrack(
  doc: TimelineDocument,
  cmd: AddVirtualClipToTrackCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;

  if (track.kind !== 'video') {
    throw new Error('Virtual clips can only be added to video tracks');
  }

  const durationTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(Number(cmd.durationTicks ?? 5 * TICKS_PER_SECOND), fps, 'round')
    : Math.max(0, Math.round(Number(cmd.durationTicks ?? 5 * TICKS_PER_SECOND)));
  const startCandidate =
    cmd.startTicks === undefined
      ? computeTrackEndTicks(track)
      : Math.max(0, Number(cmd.startTicks));
  const startTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(startCandidate, fps, 'round')
    : Math.max(0, Math.round(startCandidate));

  const base: Omit<Extract<TimelineClipItem, { kind: 'clip' }>, 'clipType'> & {
    clipType: AddVirtualClipToTrackCommand['clipType'];
  } = {
    kind: 'clip',
    clipType: cmd.clipType,
    id: cmd.clipId || nextItemId(track.id, 'clip'),
    trackId: track.id,
    name: cmd.name,
    timelineRange: { startTicks, durationTicks },
    sourceRange: { startTicks: 0, durationTicks },
    audioFadeInCurve: cmd.audioFadeInCurve,
    audioFadeOutCurve: cmd.audioFadeOutCurve,
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
        snapToPixelGrid: cmd.snapToPixelGrid ?? false,
      };
      break;
    case 'shape':
      clip = {
        ...base,
        clipType: 'shape',
        shapeType: cmd.shapeType ?? 'square',
        fillColor: cmd.fillColor ?? '#ffffff',
        strokeColor: cmd.strokeColor,
        strokeWidth: cmd.strokeWidth,
        shapeConfig: cmd.shapeConfig,
        snapToPixelGrid: cmd.snapToPixelGrid ?? false,
      };
      break;
    case 'hud':
      clip = {
        ...base,
        clipType: 'hud',
        hudType: cmd.hudType ?? 'media_frame',
        background: cmd.background,
        content: cmd.content,
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
    const sliced = sliceTrackItemsForOverlay(track.items, startTicks, durationTicks, fps, false);
    const nextItemsRaw = [...sliced, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  } else {
    assertNoOverlap(track, '', startTicks, durationTicks);
    const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, { quantizeToFrames: false });
    nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
  }

  return {
    next: {
      ...doc,
      tracks: nextTracks,
    },
    createdItemIds: [clip.id],
  };
}
