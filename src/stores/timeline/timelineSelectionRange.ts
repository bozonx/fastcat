import { ref, type Ref } from 'vue';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import type { createTimelineTrimming } from './timelineTrimming';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineSelectionRangeDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  isSelectionRangeSelected: () => boolean;
  selectTimelineSelectionRange: () => void;
  clearSelection: () => void;
  markerService: ReturnType<typeof createTimelineMarkerService>;
  trimming: ReturnType<typeof createTimelineTrimming>;
  applyTimeline: (cmd: TimelineCommand, options?: any) => void;
  defaultStaticClipDurationUs: number;
}

export function createTimelineSelectionRange(params: TimelineSelectionRangeDeps) {
  const {
    timelineDoc,
    currentTime,
    isSelectionRangeSelected: checkSelectionRangeSelected,
    selectTimelineSelectionRange,
    clearSelection,
    markerService,
    trimming,
    applyTimeline,
    defaultStaticClipDurationUs,
  } = params;

  const previewRange = ref<TimelineSelectionRange | null>(null);

  function getSelectionRange(): TimelineSelectionRange | null {
    const range = previewRange.value || timelineDoc.value?.metadata?.fastcat?.selectionRange;
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

  function setPreviewSelectionRange(range: TimelineSelectionRange | null) {
    previewRange.value = range;
  }

  function updateSelectionRange(range: TimelineSelectionRange | null, options?: any) {
    previewRange.value = null;

    if (!range) {
      applyTimeline(
        {
          type: 'update_timeline_properties',
          properties: { selectionRange: undefined },
        },
        options,
      );
      return;
    }

    applyTimeline(
      {
        type: 'update_timeline_properties',
        properties: {
          selectionRange: {
            startUs: Math.max(0, Math.round(range.startUs)),
            endUs: Math.max(Math.round(range.startUs), Math.round(range.endUs)),
          },
        },
      },
      options,
    );
  }

  function createSelectionRangeAtPlayhead(durationUs?: number) {
    const startUs = Math.max(0, Math.round(currentTime.value));
    const dur = durationUs ?? defaultStaticClipDurationUs;
    updateSelectionRange({
      startUs,
      endUs: startUs + Math.max(1, Math.round(dur)),
    });
    selectTimelineSelectionRange();
  }

  function createSelectionRange(input: TimelineSelectionRange) {
    updateSelectionRange({
      startUs: Math.max(0, Math.round(input.startUs)),
      endUs: Math.max(Math.round(input.startUs) + 1, Math.round(input.endUs)),
    });
    selectTimelineSelectionRange();
  }

  function removeSelectionRange(options?: any) {
    updateSelectionRange(null, options);
    if (checkSelectionRangeSelected()) {
      clearSelection();
    }
  }

  function convertMarkerToSelectionRange(markerId: string) {
    const marker = markerService.getMarkers().find((item) => item.id === markerId);
    if (!marker) return;

    const startUs = Math.max(0, Math.round(marker.timeUs));
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? defaultStaticClipDurationUs));

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
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? defaultStaticClipDurationUs));

    createSelectionRange({
      startUs,
      endUs: startUs + durationUs,
    });
  }

  function isSelectionRangeSelected() {
    return checkSelectionRangeSelected();
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

    const options = {
      historyMode: 'debounced',
      historyDebounceMs: 100,
      labelKey: 'videoEditor.fileManager.history.entries.deleteItems',
    };

    trimming.rippleDeleteRange(
      {
        trackIds: doc.tracks.map((track) => track.id),
        startUs: range.startUs,
        endUs: range.endUs,
      },
      options,
    );

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
          markerService.updateMarker(
            marker.id,
            {
              timeUs: Math.max(0, markerStartUs - deltaUs),
            },
            options,
          );
          continue;
        }

        // Marker intersects the deleted range
        if (marker.durationUs !== undefined) {
          // It's a zone marker: reduce duration or remove if fully inside
          const newStartUs = Math.min(markerStartUs, range.startUs);
          const newEndUs = Math.max(markerEndUs, range.endUs) - deltaUs;

          if (newEndUs <= newStartUs) {
            markerService.removeMarker(marker.id, options);
          } else {
            markerService.updateMarker(
              marker.id,
              {
                timeUs: newStartUs,
                durationUs: newEndUs - newStartUs,
              },
              options,
            );
          }
        } else {
          // Regular point marker inside the deleted range: remove it
          markerService.removeMarker(marker.id, options);
        }
      }
    }

    removeSelectionRange(options);
  }

  return {
    getSelectionRange,
    setPreviewSelectionRange,
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
