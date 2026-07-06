import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createMarkerId } from '~/timeline/id';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: Record<string, unknown>) => void;
  defaultZoneDurationUs: number;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarker: (
    input: { timeUs: number; durationUs?: number; text?: string; color?: string },
    options?: Record<string, unknown>,
  ) => string;
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
  return createMarkerId();
}

export function createTimelineMarkerService(
  deps: TimelineMarkerServiceDeps,
): TimelineMarkerService {
  function getMarkers(): TimelineMarker[] {
    const raw = deps.getDoc()?.metadata?.fastcat?.markers;
    return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
  }

  function addMarker(
    input: { timeUs: number; durationUs?: number; text?: string; color?: string },
    options?: Record<string, unknown>,
  ): string {
    const id = generateMarkerId();
    deps.applyTimeline(
      {
        type: 'add_marker',
        id,
        timeUs: input.timeUs,
        ...(input.durationUs !== undefined ? { durationUs: input.durationUs } : {}),
        text: input.text ?? '',
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      options,
    );
    return id;
  }

  function addMarkerAtPlayhead(options?: Record<string, unknown>) {
    addMarker({ timeUs: deps.getCurrentTime(), text: '' }, options);
  }

  function addZoneMarkerAtPlayhead(options?: Record<string, unknown>) {
    addMarker(
      { timeUs: deps.getCurrentTime(), durationUs: deps.defaultZoneDurationUs, text: '' },
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
      { historyMode: 'debounced', ...options },
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
    addMarker,
    addMarkerAtPlayhead,
    addZoneMarkerAtPlayhead,
    updateMarker,
    removeMarker,
    convertMarkerToZone,
    convertZoneToMarker,
  };
}
