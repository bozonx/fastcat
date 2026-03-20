import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createTimelineSelectionRange } from '~/stores/timeline/timeline-selection-range';
import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';

describe('timeline-selection-range', () => {
  let timelineDoc: any;
  let currentTime: any;
  let isSelectionRangeSelected: ReturnType<typeof vi.fn>;
  let selectTimelineSelectionRange: ReturnType<typeof vi.fn>;
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
    clearSelection = vi.fn();
    markerService = {
      getMarkers: vi.fn().mockReturnValue([]),
      addMarkerAtPlayhead: vi.fn(),
      updateMarker: vi.fn(),
      removeMarker: vi.fn(),
    };
    trimming = {
      rippleDeleteRange: vi.fn(),
    };
    applyTimeline = vi.fn();

    selectionRange = createTimelineSelectionRange({
      timelineDoc,
      currentTime,
      isSelectionRangeSelected,
      selectTimelineSelectionRange,
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
    expect(applyTimeline).toHaveBeenCalledWith(
      {
        type: 'update_timeline_properties',
        properties: { selectionRange: { startUs: 1000000, endUs: 3000000 } },
      },
      undefined,
    );
  });

  it('removes selection range', () => {
    isSelectionRangeSelected.mockReturnValue(true);
    selectionRange.removeSelectionRange();

    expect(applyTimeline).toHaveBeenCalledWith(
      {
        type: 'update_timeline_properties',
        properties: { selectionRange: undefined },
      },
      undefined,
    );
    expect(clearSelection).toHaveBeenCalled();
  });

  it('creates selection range at playhead', () => {
    currentTime.value = 2000000;
    selectionRange.createSelectionRangeAtPlayhead();

    expect(applyTimeline).toHaveBeenCalledWith(
      {
        type: 'update_timeline_properties',
        properties: { selectionRange: { startUs: 2000000, endUs: 7000000 } },
      },
      undefined,
    );
    expect(selectTimelineSelectionRange).toHaveBeenCalled();
  });
});
