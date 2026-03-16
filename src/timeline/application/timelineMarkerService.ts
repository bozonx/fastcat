import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand) => void;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarkerAtPlayhead: () => void;
  addZoneMarkerAtPlayhead: () => void;
  updateMarker: (
    markerId: string,
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string },
  ) => void;
  removeMarker: (markerId: string) => void;
  convertMarkerToZone: (markerId: string) => void;
  convertZoneToMarker: (markerId: string) => void;
}

function generateMarkerId(): string {
  return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createTimelineMarkerService(
  deps: TimelineMarkerServiceDeps,
): TimelineMarkerService {
  function getMarkers(): TimelineMarker[] {
    const raw = deps.getDoc()?.metadata?.fastcat?.markers;
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

  function addZoneMarkerAtPlayhead() {
    deps.applyTimeline({
      type: 'add_marker',
      id: generateMarkerId(),
      timeUs: deps.getCurrentTime(),
      durationUs: TIMELINE_RULER_CONSTANTS.DEFAULT_ZONE_DURATION_US,
      text: '',
    });
  }

  function updateMarker(
    markerId: string,
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string },
  ) {
    deps.applyTimeline({
      type: 'update_marker',
      id: markerId,
      timeUs: patch.timeUs,
      durationUs: patch.durationUs,
      text: patch.text,
      color: patch.color,
    } as const);
  }

  function removeMarker(markerId: string) {
    deps.applyTimeline({ type: 'remove_marker', id: markerId });
  }

  function convertMarkerToZone(markerId: string) {
    deps.applyTimeline({
      type: 'update_marker',
      id: markerId,
      durationUs: TIMELINE_RULER_CONSTANTS.DEFAULT_ZONE_DURATION_US,
    });
  }

  function convertZoneToMarker(markerId: string) {
    deps.applyTimeline({
      type: 'update_marker',
      id: markerId,
      durationUs: null,
    });
  }

  return {
    getMarkers,
    addMarkerAtPlayhead,
    addZoneMarkerAtPlayhead,
    updateMarker,
    removeMarker,
    convertMarkerToZone,
    convertZoneToMarker,
  };
}
