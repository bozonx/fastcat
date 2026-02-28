import type { Ref } from 'vue';

import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineMarkersDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  applyTimeline: (cmd: TimelineCommand) => void;
}

export interface TimelineMarkersApi {
  getMarkers: () => TimelineMarker[];
  addMarkerAtPlayhead: () => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; text?: string }) => void;
  removeMarker: (markerId: string) => void;
}

export function createTimelineMarkers(deps: TimelineMarkersDeps): TimelineMarkersApi {
  function getMarkers(): TimelineMarker[] {
    const raw = (deps.timelineDoc.value as any)?.metadata?.gran?.markers;
    return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
  }

  function generateMarkerId(): string {
    return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function addMarkerAtPlayhead() {
    deps.applyTimeline({
      type: 'add_marker',
      id: generateMarkerId(),
      timeUs: deps.currentTime.value,
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
