import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createMarkerId } from '~/timeline/id';

export interface TimelineMarkerServiceDeps {
  getDoc: () => TimelineDocument | null;
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: Record<string, unknown>) => void;
  defaultZoneDurationTicks: number;
}

export interface TimelineMarkerService {
  getMarkers: () => TimelineMarker[];
  addMarker: (
    input: { timeTicks: number; durationTicks?: number; text?: string; color?: string },
    options?: Record<string, unknown>,
  ) => string;
  addMarkerAtPlayhead: (options?: Record<string, unknown>) => void;
  addZoneMarkerAtPlayhead: (options?: Record<string, unknown>) => void;
  updateMarker: (
    markerId: string,
    patch: { timeTicks?: number; durationTicks?: number | null; text?: string; color?: string },
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
    input: { timeTicks: number; durationTicks?: number; text?: string; color?: string },
    options?: Record<string, unknown>,
  ): string {
    const id = generateMarkerId();
    deps.applyTimeline(
      {
        type: 'add_marker',
        id,
        timeTicks: input.timeTicks,
        ...(input.durationTicks !== undefined ? { durationTicks: input.durationTicks } : {}),
        text: input.text ?? '',
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      options,
    );
    return id;
  }

  function addMarkerAtPlayhead(options?: Record<string, unknown>) {
    addMarker({ timeTicks: deps.getCurrentTime(), text: '' }, options);
  }

  function addZoneMarkerAtPlayhead(options?: Record<string, unknown>) {
    addMarker(
      { timeTicks: deps.getCurrentTime(), durationTicks: deps.defaultZoneDurationTicks, text: '' },
      options,
    );
  }

  function updateMarker(
    markerId: string,
    patch: { timeTicks?: number; durationTicks?: number | null; text?: string; color?: string },
    options?: Record<string, unknown>,
  ) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        timeTicks: patch.timeTicks,
        durationTicks: patch.durationTicks,
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
        durationTicks: deps.defaultZoneDurationTicks,
      },
      options,
    );
  }

  function convertZoneToMarker(markerId: string, options?: Record<string, unknown>) {
    deps.applyTimeline(
      {
        type: 'update_marker',
        id: markerId,
        durationTicks: null,
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
