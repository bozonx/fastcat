import type { Ref } from 'vue';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { useSelectionStore } from '~/stores/selection.store';
import type { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import type { createTimelineTrimming } from './timelineTrimming';

interface CreateTimelineSelectionRangeParams {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  applyTimeline: (cmd: TimelineCommand) => void;
  selectionStore: ReturnType<typeof useSelectionStore>;
  markerService: ReturnType<typeof createTimelineMarkerService>;
  trimming: ReturnType<typeof createTimelineTrimming>;
}

export function createTimelineSelectionRange(params: CreateTimelineSelectionRangeParams) {
  const { timelineDoc, currentTime, applyTimeline, selectionStore, markerService, trimming } = params;

  function getSelectionRange(): TimelineSelectionRange | null {
    const range = timelineDoc.value?.metadata?.fastcat?.selectionRange;
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
    const currentFastCat = timelineDoc.value?.metadata?.fastcat ?? {};
    applyTimeline({
      type: 'update_timeline_properties',
      properties: {
        ...currentFastCat,
        selectionRange: range
          ? {
              startUs: Math.max(0, Math.round(range.startUs)),
              endUs: Math.max(Math.round(range.startUs), Math.round(range.endUs)),
            }
          : undefined,
      },
    });
  }

  function createSelectionRangeAtPlayhead(durationUs = 5_000_000) {
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

    applyTimeline({
      type: 'add_marker',
      id: `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      timeUs: range.startUs,
      durationUs: range.endUs - range.startUs,
      text: '',
    });
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

        if (markerEndUs <= range.startUs) continue;

        if (markerStartUs >= range.endUs) {
          markerService.updateMarker(marker.id, {
            timeUs: Math.max(0, markerStartUs - deltaUs),
          });
          continue;
        }

        markerService.removeMarker(marker.id);
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
