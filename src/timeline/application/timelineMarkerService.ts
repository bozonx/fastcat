import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: Record<string, unknown>) => void;
  defaultZoneDurationUs: number;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarkerAtPlayhead: (options?: Record<string, unknown>) => void;
  addZoneMarkerAtPlayhead: (options?: Record<string, unknown>) => void;
  updateMarker: (
    markerId: string,
    patch: { timeUs?: number; durationUs?: number | null; text?: string; color?: string },
    options?: Record<string, unknown>,
  ) => void;
  removeMarker: (markerId: string, options?: Record<string, unknown>) => void;
  convertMarkerToZone: (markerId: string, options?: Record<string, unknown>) => void;
  convertZoneToMarker: (markerId: string, options?: Record<string, unknown>) => void;
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

  function addMarkerAtPlayhead(options?: Record<string, unknown>) {
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

  function addZoneMarkerAtPlayhead(options?: Record<string, unknown>) {
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
    options?: Record<string, unknown>,
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

  function removeMarker(markerId: string, options?: Record<string, unknown>) {
    deps.applyTimeline({ type: 'remove_marker', id: markerId }, options);
  }

  function convertMarkerToZone(markerId: string, options?: Record<string, unknown>) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        durationUs: deps.defaultZoneDurationUs,
      },
      options,
    );
  }

  function convertZoneToMarker(markerId: string, options?: Record<string, unknown>) {
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
