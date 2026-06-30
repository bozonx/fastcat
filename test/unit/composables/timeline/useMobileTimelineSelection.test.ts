/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, nextTick, reactive } from 'vue';

import { useMobileTimelineSelection } from '~/composables/timeline/useMobileTimelineSelection';
import type { TimelineTrack } from '~/timeline/types';

const mockTimelineStore = {
  selectedItemIds: [] as string[],
  markers: [] as Array<{ id: string }>,
  selectedTransition: null as { trackId: string; itemId: string } | null,
  toggleSelection: vi.fn((id: string, opts?: { multi?: boolean }) => {
    const idx = mockTimelineStore.selectedItemIds.indexOf(id);
    if (opts?.multi) {
      if (idx >= 0) mockTimelineStore.selectedItemIds.splice(idx, 1);
      else mockTimelineStore.selectedItemIds.push(id);
    } else {
      mockTimelineStore.selectedItemIds = [id];
    }
  }),
  clearSelection: vi.fn(() => {
    mockTimelineStore.selectedItemIds = [];
  }),
  selectTrack: vi.fn(),
  selectTransition: vi.fn(),
};

const mockSelectionStore = reactive({
  selectedEntity: null as { source: string; kind: string; [key: string]: unknown } | null,
  clearSelection: vi.fn(() => {
    mockSelectionStore.selectedEntity = null;
  }),
  selectTimelineItems: vi.fn((items: unknown[]) => {
    mockSelectionStore.selectedEntity =
      items.length > 0 ? { source: 'timeline', kind: 'clips', items } : null;
  }),
  selectTimelineMarker: vi.fn((id: string) => {
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'marker', markerId: id };
  }),
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

describe('useMobileTimelineSelection', () => {
  beforeEach(() => {
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.markers = [];
    mockTimelineStore.selectedTransition = null;
    mockSelectionStore.selectedEntity = null;
    vi.clearAllMocks();
  });

  function createTracks(): TimelineTrack[] {
    return [
      {
        id: 'track-1',
        kind: 'video',
        name: 'Video 1',
        items: [
          {
            id: 'clip-a',
            kind: 'clip',
            name: 'Clip A',
            clipType: 'media',
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
            locked: false,
            disabled: false,
          } as TimelineTrack['items'][number],
          {
            id: 'gap-1',
            kind: 'gap',
            timelineRange: { startUs: 1_000_000, durationUs: 500_000 },
          } as TimelineTrack['items'][number],
        ],
      },
      {
        id: 'track-2',
        kind: 'audio',
        name: 'Audio 1',
        items: [
          {
            id: 'clip-b',
            kind: 'clip',
            name: 'Clip B',
            clipType: 'media',
            timelineRange: { startUs: 0, durationUs: 2_000_000 },
            sourceRange: { startUs: 0, durationUs: 2_000_000 },
            locked: false,
            disabled: false,
          } as TimelineTrack['items'][number],
        ],
      },
    ];
  }

  it('selectedClips returns only clip items', () => {
    const tracks = ref(createTracks());
    mockTimelineStore.selectedItemIds = ['clip-a', 'gap-1'];

    const { selectedClips } = useMobileTimelineSelection(
      tracks,
      ref(false),
      ref(false),
      ref(false),
      () => {},
    );

    expect(selectedClips.value).toHaveLength(1);
    expect(selectedClips.value![0]).toEqual({ trackId: 'track-1', itemId: 'clip-a' });
  });

  it('toggleMobileClipSelection enters multi-selection mode', async () => {
    const tracks = ref(createTracks());
    const isClipPropertiesDrawerOpen = ref(false);
    const isMultiSelectionDrawerOpen = ref(false);
    const isMultiSelectionMode = ref(false);

    const { toggleMobileClipSelection, selectedClips } = useMobileTimelineSelection(
      tracks,
      isClipPropertiesDrawerOpen,
      isMultiSelectionDrawerOpen,
      isMultiSelectionMode,
      () => {},
    );

    toggleMobileClipSelection('clip-a');
    await nextTick();

    expect(mockTimelineStore.toggleSelection).toHaveBeenCalledWith('clip-a', { multi: true });
    expect(mockTimelineStore.selectTrack).toHaveBeenCalledWith(null);
    expect(mockTimelineStore.selectTransition).toHaveBeenCalledWith(null);
    expect(selectedClips.value).toHaveLength(1);
    expect(selectedClips.value![0]).toEqual({ trackId: 'track-1', itemId: 'clip-a' });
    expect(isMultiSelectionMode.value).toBe(false);
  });

  it('enterMobileMultiSelection opens multi-selection drawer for already selected item', () => {
    const tracks = ref(createTracks());
    mockTimelineStore.selectedItemIds = ['clip-a'];
    const isClipPropertiesDrawerOpen = ref(true);
    const isMultiSelectionDrawerOpen = ref(false);

    const { enterMobileMultiSelection } = useMobileTimelineSelection(
      tracks,
      isClipPropertiesDrawerOpen,
      isMultiSelectionDrawerOpen,
      ref(false),
      () => {},
    );

    enterMobileMultiSelection('clip-a');
    expect(isClipPropertiesDrawerOpen.value).toBe(false);
    expect(isMultiSelectionDrawerOpen.value).toBe(true);
  });

  it('syncSelectionStoreFromItemIds maps ids to track/item pairs', () => {
    const tracks = ref(createTracks());
    mockTimelineStore.selectedItemIds = ['clip-a', 'clip-b'];

    const { selectedClips } = useMobileTimelineSelection(
      tracks,
      ref(false),
      ref(false),
      ref(false),
      () => {},
    );

    expect(selectedClips.value).toHaveLength(2);
    expect(selectedClips.value).toContainEqual({ trackId: 'track-1', itemId: 'clip-a' });
    expect(selectedClips.value).toContainEqual({ trackId: 'track-2', itemId: 'clip-b' });
  });

  it('selectedMarkerId validates marker existence', () => {
    const tracks = ref(createTracks());
    mockTimelineStore.markers = [{ id: 'm1' }];
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'marker', markerId: 'm1' };

    const { selectedMarkerId } = useMobileTimelineSelection(
      tracks,
      ref(false),
      ref(false),
      ref(false),
      () => {},
    );

    expect(selectedMarkerId.value).toBe('m1');

    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'marker', markerId: 'm2' };
    expect(selectedMarkerId.value).toBeNull();
  });
});
