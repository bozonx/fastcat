import type { TimelineDocument, TimelineMarker } from '../types';
import type {
  AddMarkerCommand,
  RemoveMarkerCommand,
  TimelineCommandResult,
  UpdateMarkerCommand,
} from '../commands';

function getMarkers(doc: TimelineDocument): TimelineMarker[] {
  const raw = (doc as any)?.metadata?.gran?.markers;
  return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
}

function withMarkers(doc: TimelineDocument, markers: TimelineMarker[]): TimelineDocument {
  return {
    ...doc,
    metadata: {
      ...(doc.metadata ?? {}),
      gran: {
        ...(doc.metadata?.gran ?? {}),
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

  const marker: TimelineMarker = {
    id: cmd.id,
    timeUs: Math.max(0, Math.round(cmd.timeUs)),
    text: typeof cmd.text === 'string' ? cmd.text : '',
  };

  const next = [...markers, marker].sort((a, b) => a.timeUs - b.timeUs);
  return { next: withMarkers(doc, next) };
}

export function updateMarker(
  doc: TimelineDocument,
  cmd: UpdateMarkerCommand,
): TimelineCommandResult {
  const markers = getMarkers(doc);
  const idx = markers.findIndex((m) => m.id === cmd.id);
  if (idx === -1) {
    throw new Error('Marker not found');
  }

  const prev = markers[idx]!;

  const nextMarker: TimelineMarker = {
    ...prev,
    timeUs:
      cmd.timeUs !== undefined
        ? Math.max(0, Math.round(Number(cmd.timeUs)))
        : prev.timeUs,
    text: cmd.text !== undefined ? String(cmd.text) : prev.text,
  };

  const nextMarkers = [...markers];
  nextMarkers[idx] = nextMarker;
  nextMarkers.sort((a, b) => a.timeUs - b.timeUs);

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
