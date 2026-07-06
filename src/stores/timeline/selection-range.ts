import { ref, type Ref } from 'vue';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import type { createTimelineTrimmingModule } from './trimming';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineApplyOptions } from './commands';

export interface TimelineSelectionRangeDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  selectionRange: Ref<TimelineSelectionRange | null>;
  isSelectionRangeSelected: () => boolean;
  selectTimelineSelectionRange: () => void;
  selectTimelineMarker?: (markerId: string) => void;
  clearSelection: () => void;
  markerService: ReturnType<typeof createTimelineMarkerService>;
  trimming: ReturnType<typeof createTimelineTrimmingModule>;
  applyTimeline: (cmd: TimelineCommand, options?: TimelineApplyOptions) => void;
  defaultStaticClipDurationUs: number;
}

export interface TimelineSelectionRangeModule {
  getSelectionRange: () => TimelineSelectionRange | null;
  setPreviewSelectionRange: (range: TimelineSelectionRange | null) => void;
  updateSelectionRange: (
    range: TimelineSelectionRange | null,
    options?: TimelineApplyOptions,
  ) => void;
  createSelectionRangeAtPlayhead: (durationUs?: number) => void;
  createSelectionRange: (input: TimelineSelectionRange) => void;
  removeSelectionRange: (options?: TimelineApplyOptions) => void;
  convertMarkerToSelectionRange: (markerId: string) => void;
  createSelectionRangeFromMarker: (markerId: string) => void;
  isSelectionRangeSelected: () => boolean;
  convertSelectionRangeToMarker: () => void;
  rippleTrimSelectionRange: () => void;
}

export function createTimelineSelectionRangeModule(
  params: TimelineSelectionRangeDeps,
): TimelineSelectionRangeModule {
  const {
    timelineDoc,
    currentTime,
    isSelectionRangeSelected: checkSelectionRangeSelected,
    selectTimelineSelectionRange,
    clearSelection,
    markerService,
    trimming,
    defaultStaticClipDurationUs,
  } = params;

  const previewRange = ref<TimelineSelectionRange | null>(null);

  function getSelectionRange(): TimelineSelectionRange | null {
    const range = previewRange.value || params.selectionRange.value;
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

  function updateSelectionRange(
    range: TimelineSelectionRange | null,
    options?: TimelineApplyOptions,
  ) {
    previewRange.value = null;

    const nextRange = range
      ? {
          startUs: Math.max(0, Math.round(range.startUs)),
          endUs: Math.max(Math.round(range.startUs), Math.round(range.endUs)),
        }
      : null;

    params.applyTimeline(
      {
        type: 'update_timeline_properties',
        properties: {
          selectionRange: nextRange,
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

  function removeSelectionRange(options?: TimelineApplyOptions) {
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

    const markerId = markerService.addMarker({
      timeUs: range.startUs,
      durationUs: range.endUs - range.startUs,
    });

    removeSelectionRange();

    // Hand the selection (and the properties panel) over to the freshly created
    // zone marker so the panel doesn't go blank once the range disappears.
    // Guard against a rejected add (e.g. a marker already exists at this time):
    // only select a marker that actually made it into the document.
    if (markerId && markerService.getMarkers().some((marker) => marker.id === markerId)) {
      params.selectTimelineMarker?.(markerId);
    }
  }

  function rippleTrimSelectionRange() {
    const range = getSelectionRange();
    const doc = timelineDoc.value;
    if (!range || !doc) return;

    const options = {
      historyMode: 'debounced' as const,
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
