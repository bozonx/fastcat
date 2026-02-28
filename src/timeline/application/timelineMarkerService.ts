import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand) => void;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarkerAtPlayhead: () => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; text?: string }) => void;
  removeMarker: (markerId: string) => void;
}

function generateMarkerId(): string {
  return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimelineMarkerService(deps: TimelineMarkerServiceDeps): TimelineMarkerService {
  function getMarkers(): TimelineMarker[] {
    const raw = deps.getDoc()?.metadata?.gran?.markers;
    return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
  }

  function addMarkerAtPlayhead() {
    deps.applyTimeline({
      type: 'add_marker',
      id: generateMarkerId(),
      timeUs: deps.getCurrentTime(),
      text: '',
    });
  }

  function updateMarker(markerId: string, patch: { timeUs?: number; text?: string }) {
    deps.applyTimeline({
      type: 'update_marker',
      id: markerId,
      timeUs: patch.timeUs,
      text: patch.text,
    });
  }

  function removeMarker(markerId: string) {
    deps.applyTimeline({ type: 'remove_marker', id: markerId });
  }

  return {
    getMarkers,
    addMarkerAtPlayhead,
    updateMarker,
    removeMarker,
  };
}
