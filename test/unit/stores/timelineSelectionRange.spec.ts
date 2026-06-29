/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createTimelineSelectionRangeModule } from '~/stores/timeline/selection-range';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';

describe('timeline-selection-range', () => {
  let timelineDoc: any;
  let currentTime: any;
  let isSelectionRangeSelected: ReturnType<typeof vi.fn>;
  let selectTimelineSelectionRange: ReturnType<typeof vi.fn>;
  let selectTimelineMarker: ReturnType<typeof vi.fn>;
  let clearSelection: ReturnType<typeof vi.fn>;
  let markerService: any;
  let trimming: any;
  let applyTimeline: ReturnType<typeof vi.fn>;
  let selectionRange: any;

  beforeEach(() => {
    timelineDoc = ref<TimelineDocument | null>({
      tracks: [{ id: 'track1', kind: 'video', items: [] }],
    } as any);
    currentTime = ref(0);
    isSelectionRangeSelected = vi.fn().mockReturnValue(false);
    selectTimelineSelectionRange = vi.fn();
    selectTimelineMarker = vi.fn();
    clearSelection = vi.fn();
    markerService = {
      getMarkers: vi.fn().mockReturnValue([]),
      addMarker: vi.fn().mockReturnValue('new-marker'),
      addMarkerAtPlayhead: vi.fn(),
      updateMarker: vi.fn(),
      removeMarker: vi.fn(),
    };
    trimming = {
      rippleDeleteRange: vi.fn(),
    };
    applyTimeline = vi.fn();
    const selectionRangeRef = ref<TimelineSelectionRange | null>(null);

    selectionRange = createTimelineSelectionRangeModule({
      timelineDoc,
      currentTime,
      selectionRange: selectionRangeRef,
      isSelectionRangeSelected,
      selectTimelineSelectionRange,
      selectTimelineMarker,
      clearSelection,
      markerService,
      trimming,
      applyTimeline,
      defaultStaticClipDurationUs: 5000000,
    });
  });

  it('gets null selection range when not set', () => {
    expect(selectionRange.getSelectionRange()).toBeNull();
  });

  it('updates selection range', () => {
    selectionRange.updateSelectionRange({ startUs: 1000000, endUs: 3000000 });
    expect(selectionRange.getSelectionRange()).toEqual({ startUs: 1000000, endUs: 3000000 });
  });

  it('removes selection range', () => {
    isSelectionRangeSelected.mockReturnValue(true);
    selectionRange.removeSelectionRange();

    expect(selectionRange.getSelectionRange()).toBeNull();
    expect(clearSelection).toHaveBeenCalled();
  });

  it('creates selection range at playhead', () => {
    currentTime.value = 2000000;
    selectionRange.createSelectionRangeAtPlayhead();

    expect(selectionRange.getSelectionRange()).toEqual({ startUs: 2000000, endUs: 7000000 });
    expect(selectTimelineSelectionRange).toHaveBeenCalled();
  });

  it('converts selection to a zone marker created directly at the range, without touching other markers', () => {
    // An existing zone sits later than the playhead — it must not be mutated.
    markerService.getMarkers.mockReturnValue([
      { id: 'existing', timeUs: 20000000, durationUs: 5000000, text: '' },
    ]);
    currentTime.value = 0;
    selectionRange.updateSelectionRange({ startUs: 4000000, endUs: 8000000 });

    selectionRange.convertSelectionRangeToMarker();

    // New marker is created straight at the selection range (no stray playhead marker, no update).
    expect(markerService.addMarker).toHaveBeenCalledWith({
      timeUs: 4000000,
      durationUs: 4000000,
    });
    expect(markerService.addMarkerAtPlayhead).not.toHaveBeenCalled();
    expect(markerService.updateMarker).not.toHaveBeenCalled();
    expect(selectionRange.getSelectionRange()).toBeNull();
  });

  it('selects the freshly created marker so the properties panel follows the conversion', () => {
    markerService.addMarker.mockReturnValue('created-marker');
    // After the add, the new marker exists in the document.
    markerService.getMarkers.mockReturnValue([
      { id: 'created-marker', timeUs: 4000000, durationUs: 4000000, text: '' },
    ]);
    selectionRange.updateSelectionRange({ startUs: 4000000, endUs: 8000000 });

    selectionRange.convertSelectionRangeToMarker();

    expect(selectTimelineMarker).toHaveBeenCalledWith('created-marker');
  });

  it('does not select a marker when the add was rejected (e.g. one already exists at that time)', () => {
    markerService.addMarker.mockReturnValue('rejected-marker');
    // The add was rejected, so the document does not contain the new marker id.
    markerService.getMarkers.mockReturnValue([]);
    selectionRange.updateSelectionRange({ startUs: 4000000, endUs: 8000000 });

    selectionRange.convertSelectionRangeToMarker();

    expect(selectTimelineMarker).not.toHaveBeenCalled();
  });

  it('converts a zone marker to a selection range, removing the marker itself', () => {
    markerService.getMarkers.mockReturnValue([
      { id: 'zone-marker', timeUs: 1000000, durationUs: 3000000, text: 'Zone' },
    ]);

    selectionRange.convertMarkerToSelectionRange('zone-marker');

    // Should create the selection range matching the zone marker's duration and position
    expect(selectionRange.getSelectionRange()).toEqual({ startUs: 1000000, endUs: 4000000 });

    // Should not call updateMarker
    expect(markerService.updateMarker).not.toHaveBeenCalled();

    // Should remove the marker
    expect(markerService.removeMarker).toHaveBeenCalledWith('zone-marker');
  });
});
