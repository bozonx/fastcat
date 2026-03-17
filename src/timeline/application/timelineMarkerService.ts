import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: any) => void;
  defaultZoneDurationUs: number;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarkerAtPlayhead: (options?: any) => void;
  addZoneMarkerAtPlayhead: (options?: any) => void;
  updateMarker: (
    markerId: string,
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string },
    options?: any,
  ) => void;
  removeMarker: (markerId: string, options?: any) => void;
  convertMarkerToZone: (markerId: string, options?: any) => void;
  convertZoneToMarker: (markerId: string, options?: any) => void;
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

  function addMarkerAtPlayhead(options?: any) {
    deps.applyTimeline(
      {
        type: 'add_marker',
        id: generateMarkerId(),
        timeUs: deps.getCurrentTime(),
        text: '',
      },
      options,
    );
  }

  function addZoneMarkerAtPlayhead(options?: any) {
    deps.applyTimeline(
      {
        type: 'add_marker',
        id: generateMarkerId(),
        timeUs: deps.getCurrentTime(),
        durationUs: deps.defaultZoneDurationUs,
        text: '',
      },
      options,
    );
  }

  function updateMarker(
    markerId: string,
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string },
    options?: any,
  ) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        timeUs: patch.timeUs,
        durationUs: patch.durationUs,
        text: patch.text,
        color: patch.color,
      } as const,
      options,
    );
  }

  function removeMarker(markerId: string, options?: any) {
    deps.applyTimeline({ type: 'remove_marker', id: markerId }, options);
  }

  function convertMarkerToZone(markerId: string, options?: any) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        durationUs: deps.defaultZoneDurationUs,
      },
      options,
    );
  }

  function convertZoneToMarker(markerId: string, options?: any) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        durationUs: null,
      },
      options,
    );
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
