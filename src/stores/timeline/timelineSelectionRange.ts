import { ref, type Ref } from 'vue';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { useSelectionStore } from '~/stores/selection.store';
import type { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import type { createTimelineTrimming } from './timelineTrimming';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';

interface CreateTimelineSelectionRangeParams {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  selectionStore: ReturnType<typeof useSelectionStore>;
  markerService: ReturnType<typeof createTimelineMarkerService>;
  trimming: ReturnType<typeof createTimelineTrimming>;
}

export function createTimelineSelectionRange(params: CreateTimelineSelectionRangeParams) {
  const { timelineDoc, currentTime, selectionStore, markerService, trimming } = params;

  const currentSelectionRange = ref<TimelineSelectionRange | null>(null);

  function getSelectionRange(): TimelineSelectionRange | null {
    const range = currentSelectionRange.value;
    if (!range) return null;
    if (!Number.isFinite(range.startUs) || !Number.isFinite(range.endUs)) return null;

    const startUs = Math.max(0, Math.round(range.startUs));
    const endUs = Math.max(startUs, Math.round(range.endUs));

    if (endUs <= startUs) return null;

    return {
      startUs,
      endUs,
    };
  }

  function updateSelectionRange(range: TimelineSelectionRange | null) {
    if (!range) {
      currentSelectionRange.value = null;
      return;
    }

    currentSelectionRange.value = {
      startUs: Math.max(0, Math.round(range.startUs)),
      endUs: Math.max(Math.round(range.startUs), Math.round(range.endUs)),
    };
  }

  function createSelectionRangeAtPlayhead(
    durationUs = TIMELINE_RULER_CONSTANTS.DEFAULT_ZONE_DURATION_US,
  ) {
    const startUs = Math.max(0, Math.round(currentTime.value));
    updateSelectionRange({
      startUs,
      endUs: startUs + Math.max(1, Math.round(durationUs)),
    });
    selectionStore.selectTimelineSelectionRange();
  }

  function createSelectionRange(input: TimelineSelectionRange) {
    updateSelectionRange({
      startUs: Math.max(0, Math.round(input.startUs)),
      endUs: Math.max(Math.round(input.startUs) + 1, Math.round(input.endUs)),
    });
    selectionStore.selectTimelineSelectionRange();
  }

  function removeSelectionRange() {
    updateSelectionRange(null);
    if (
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'selection-range'
    ) {
      selectionStore.clearSelection();
    }
  }

  function convertMarkerToSelectionRange(markerId: string) {
    const marker = markerService.getMarkers().find((item) => item.id === markerId);
    if (!marker) return;

    const startUs = Math.max(0, Math.round(marker.timeUs));
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? 5_000_000));

    createSelectionRange({
      startUs,
      endUs: startUs + durationUs,
    });
    markerService.removeMarker(markerId);
  }

  function createSelectionRangeFromMarker(markerId: string) {
    const marker = markerService.getMarkers().find((item) => item.id === markerId);
    if (!marker) return;

    const startUs = Math.max(0, Math.round(marker.timeUs));
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? 5_000_000));

    createSelectionRange({
      startUs,
      endUs: startUs + durationUs,
    });
  }

  function isSelectionRangeSelected() {
    return (
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'selection-range'
    );
  }

  function convertSelectionRangeToMarker() {
    const range = getSelectionRange();
    if (!range) return;

    markerService.addMarkerAtPlayhead();
    const markers = markerService.getMarkers();
    const lastMarker = markers[markers.length - 1];

    if (lastMarker) {
      markerService.updateMarker(lastMarker.id, {
        timeUs: range.startUs,
        durationUs: range.endUs - range.startUs,
      });
    }

    removeSelectionRange();
  }

  function rippleTrimSelectionRange() {
    const range = getSelectionRange();
    const doc = timelineDoc.value;
    if (!range || !doc) return;

    trimming.rippleDeleteRange({
      trackIds: doc.tracks.map((track) => track.id),
      startUs: range.startUs,
      endUs: range.endUs,
    });

    const deltaUs = range.endUs - range.startUs;
    if (deltaUs > 0) {
      const markers = markerService.getMarkers();
      for (const marker of markers) {
        const markerStartUs = marker.timeUs;
        const markerEndUs = marker.timeUs + Math.max(0, marker.durationUs ?? 0);

        // Marker ends before the deleted range
        if (markerEndUs <= range.startUs) continue;

        // Marker starts after the deleted range (shift left)
        if (markerStartUs >= range.endUs) {
          markerService.updateMarker(marker.id, {
            timeUs: Math.max(0, markerStartUs - deltaUs),
          });
          continue;
        }

        // Marker intersects the deleted range
        if (marker.durationUs !== undefined) {
          // It's a zone marker: reduce duration or remove if fully inside
          const newStartUs = Math.min(markerStartUs, range.startUs);
          const newEndUs = Math.max(markerEndUs, range.endUs) - deltaUs;

          if (newEndUs <= newStartUs) {
            markerService.removeMarker(marker.id);
          } else {
            markerService.updateMarker(marker.id, {
              timeUs: newStartUs,
              durationUs: newEndUs - newStartUs,
            });
          }
        } else {
          // Regular point marker inside the deleted range: remove it
          markerService.removeMarker(marker.id);
        }
      }
    }

    removeSelectionRange();
  }

  return {
    getSelectionRange,
    updateSelectionRange,
    createSelectionRangeAtPlayhead,
    createSelectionRange,
    removeSelectionRange,
    convertMarkerToSelectionRange,
    createSelectionRangeFromMarker,
    isSelectionRangeSelected,
    convertSelectionRangeToMarker,
    rippleTrimSelectionRange,
  };
}
