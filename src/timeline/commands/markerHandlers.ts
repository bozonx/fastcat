import { createDevLogger } from '~/utils/dev-logger';
import type { TimelineDocument, TimelineMarker } from '../types';
import type {
  AddMarkerCommand,
  RemoveMarkerCommand,
  TimelineCommandResult,
  UpdateMarkerCommand,
} from '../commands';
import { sanitizeFps, quantizeTimeUsToFrames } from './utils';
const log = createDevLogger('markerHandlers');

/** Markers always live on the frame grid, regardless of the entry path. */
function snapMarkerTimeTicks(value: number, fps: number): number {
  return Math.max(0, quantizeTimeUsToFrames(Math.max(0, Number(value)), fps, 'round'));
}

function getMarkers(doc: TimelineDocument): TimelineMarker[] {
  const raw = (doc as { metadata?: { fastcat?: { markers?: unknown } } })?.metadata?.fastcat
    ?.markers;
  return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
}

function withMarkers(doc: TimelineDocument, markers: TimelineMarker[]): TimelineDocument {
  return {
    ...doc,
    metadata: {
      ...(doc.metadata ?? {}),
      fastcat: {
        ...(doc.metadata?.fastcat ?? {}),
        docId: doc.id,
        timebase: doc.timebase,
        markers,
      },
    },
  };
}

export function addMarker(doc: TimelineDocument, cmd: AddMarkerCommand): TimelineCommandResult {
  const markers = getMarkers(doc);
  if (markers.some((m) => m.id === cmd.id)) {
    throw new Error('Marker already exists');
  }

  const fps = sanitizeFps(doc.timebase);
  const marker: TimelineMarker = {
    id: cmd.id,
    timeTicks: snapMarkerTimeTicks(cmd.timeTicks, fps),
    durationTicks: cmd.durationTicks !== undefined ? snapMarkerTimeTicks(cmd.durationTicks, fps) : undefined,
    text: typeof cmd.text === 'string' ? cmd.text : '',
    color:
      typeof (cmd as { color?: string }).color === 'string'
        ? String((cmd as { color: string }).color)
        : '#eab308',
  };

  if (markers.some((m) => m.timeTicks === marker.timeTicks)) {
    throw new Error('Marker already exists at this time');
  }

  const next = [...markers, marker].sort((a, b) => a.timeTicks - b.timeTicks);
  return { next: withMarkers(doc, next) };
}

export function updateMarker(
  doc: TimelineDocument,
  cmd: UpdateMarkerCommand,
): TimelineCommandResult {
  const markers = getMarkers(doc);
  const idx = markers.findIndex((m) => m.id === cmd.id);
  if (idx === -1) {
    log.warn('Marker not found for update, skipping:', cmd.id);
    return { next: doc };
  }

  const prev = markers[idx]!;

  const fps = sanitizeFps(doc.timebase);
  const nextMarker: TimelineMarker = {
    ...prev,
    timeTicks: cmd.timeTicks !== undefined ? snapMarkerTimeTicks(cmd.timeTicks, fps) : prev.timeTicks,
    durationTicks:
      cmd.durationTicks !== undefined
        ? cmd.durationTicks === null
          ? undefined
          : snapMarkerTimeTicks(cmd.durationTicks, fps)
        : prev.durationTicks,
    text: cmd.text !== undefined ? String(cmd.text) : prev.text,
    color: cmd.color !== undefined ? String(cmd.color) : (prev as { color?: string }).color,
  };

  if (markers.some((m) => m.id !== cmd.id && m.timeTicks === nextMarker.timeTicks)) {
    throw new Error('Marker already exists at this time');
  }

  const nextMarkers = [...markers];
  nextMarkers[idx] = nextMarker;
  nextMarkers.sort((a, b) => a.timeTicks - b.timeTicks);

  return { next: withMarkers(doc, nextMarkers) };
}

export function removeMarker(
  doc: TimelineDocument,
  cmd: RemoveMarkerCommand,
): TimelineCommandResult {
  const markers = getMarkers(doc);
  if (!markers.some((m) => m.id === cmd.id)) {
    return { next: doc };
  }
  const nextMarkers = markers.filter((m) => m.id !== cmd.id);
  return { next: withMarkers(doc, nextMarkers) };
}
