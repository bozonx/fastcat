/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick, defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useMobileTimelineDrawers } from '~/composables/timeline/useMobileTimelineDrawers';

interface SelectedEntity {
  source: string;
  kind: string;
  itemId?: string;
  trackId?: string;
  markerId?: string;
}

const mockTimelineStore = {
  selectedTrackId: null as string | null,
  selectedItemIds: [] as string[],
  selectedTransition: null as { trackId: string; itemId: string; edge: 'in' | 'out' } | null,
  markers: [] as Array<{ id: string }>,
  selectTrack: vi.fn(),
  clearSelection: vi.fn(),
  selectTransition: vi.fn(),
};

const mockSelectionStore = {
  selectedEntity: null as SelectedEntity | null,
  clearSelection: vi.fn(),
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

type DrawersApi = ReturnType<typeof useMobileTimelineDrawers>;

/**
 * Mounts a host component and captures the composable's raw return object.
 * `wrapper.vm` would auto-unwrap refs, so we keep the original refs instead.
 */
function mountDrawers(): { api: DrawersApi; unmount: () => void } {
  let api!: DrawersApi;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useMobileTimelineDrawers();
        return () => null;
      },
    }),
  );
  return { api, unmount: () => wrapper.unmount() };
}

describe('useMobileTimelineDrawers', () => {
  beforeEach(() => {
    mockTimelineStore.selectedTrackId = null;
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.selectedTransition = null;
    mockTimelineStore.markers = [];
    mockTimelineStore.selectTrack.mockClear();
    mockTimelineStore.clearSelection.mockClear();
    mockTimelineStore.selectTransition.mockClear();
    mockSelectionStore.selectedEntity = null;
    mockSelectionStore.clearSelection.mockClear();
  });

  it('initially closes all drawers', () => {
    const { api, unmount } = mountDrawers();
    expect(api.isAnyDrawerOpen.value).toBe(false);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);
    expect(api.isTrackPropertiesDrawerOpen.value).toBe(false);
    unmount();
  });

  it('opens the clip properties drawer when a single clip is selected', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clip', itemId: 'clip-1' };
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isClipPropertiesDrawerOpen.value).toBe(true);
    expect(api.isMultiSelectionDrawerOpen.value).toBe(false);
    unmount();
  });

  it('opens the multi-selection drawer when multiple clips are selected', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1', 'clip-2'];
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clips' };
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isMultiSelectionDrawerOpen.value).toBe(true);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);
    unmount();
  });

  it('opens the track properties drawer when only a track is selected', async () => {
    mockTimelineStore.selectedTrackId = 'track-1';
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isTrackPropertiesDrawerOpen.value).toBe(true);
    unmount();
  });

  it('opens the marker properties drawer when a marker is selected', async () => {
    mockTimelineStore.markers = [{ id: 'marker-1' }];
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'marker',
      markerId: 'marker-1',
    };
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isMarkerPropertiesDrawerOpen.value).toBe(true);
    unmount();
  });

  it('opens the transition drawer when a transition is selected', async () => {
    mockTimelineStore.selectedTransition = { trackId: 'track-1', itemId: 'clip-1', edge: 'in' };
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isTransitionDrawerOpen.value).toBe(true);
    unmount();
  });

  it('opens the settings drawer with a high snap point for timeline properties', async () => {
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'timeline-properties' };
    const { api, unmount } = mountDrawers();
    await nextTick();

    expect(api.isSettingsDrawerOpen.value).toBe(true);
    expect(api.drawerActiveSnapPoint.value).toBe(0.92);
    unmount();
  });

  it('closes all drawers on request', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clip', itemId: 'clip-1' };
    const { api, unmount } = mountDrawers();
    await nextTick();
    expect(api.isClipPropertiesDrawerOpen.value).toBe(true);

    api.closeAllDrawers();

    expect(api.isAnyDrawerOpen.value).toBe(false);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);
    unmount();
  });

  it('opens toolbar drawers exclusively', () => {
    const { api, unmount } = mountDrawers();

    api.openTrackMixerDrawer();
    expect(api.isTrackMixerDrawerOpen.value).toBe(true);
    expect(api.isTrackManagerDrawerOpen.value).toBe(false);

    api.openTrackManagerDrawer();
    expect(api.isTrackMixerDrawerOpen.value).toBe(false);
    expect(api.isTrackManagerDrawerOpen.value).toBe(true);

    api.openHistoryDrawer();
    expect(api.isTrackManagerDrawerOpen.value).toBe(false);
    expect(api.isHistoryDrawerOpen.value).toBe(true);

    api.openMarkersDrawer();
    expect(api.isHistoryDrawerOpen.value).toBe(false);
    expect(api.isMarkersDrawerOpen.value).toBe(true);
    unmount();
  });

  it('navigates between clip sub-drawers and back', () => {
    const { api, unmount } = mountDrawers();

    api.isClipPropertiesDrawerOpen.value = true;
    api.openClipDeleteDrawer();
    expect(api.isDeleteDrawerOpen.value).toBe(true);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);

    api.backToClipProperties();
    expect(api.isDeleteDrawerOpen.value).toBe(false);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(true);

    api.openClipTrimDrawer();
    expect(api.isTrimDrawerOpen.value).toBe(true);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);

    api.backToClipProperties();
    api.openClipTransitionsPanel();
    expect(api.isTransitionsPanelOpen.value).toBe(true);
    expect(api.isClipPropertiesDrawerOpen.value).toBe(false);
    unmount();
  });

  it('clears track selection when a drawer is closed externally', () => {
    mockTimelineStore.selectedTrackId = 'track-1';
    const { api, unmount } = mountDrawers();

    api.isLongPress.value = true;
    api.onUpdateDrawerOpen(false);

    expect(mockTimelineStore.selectTrack).toHaveBeenCalledWith(null);
    expect(api.isLongPress.value).toBe(false);
    unmount();
  });

  it('clears clip selection when the clip properties drawer closes', () => {
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clip', itemId: 'clip-1' };
    const { api, unmount } = mountDrawers();

    api.onClipPropertiesDrawerClose();

    expect(mockTimelineStore.clearSelection).toHaveBeenCalled();
    expect(mockSelectionStore.clearSelection).toHaveBeenCalled();
    unmount();
  });

  it('does not clear clip selection while suppression is active', async () => {
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clip', itemId: 'clip-1' };
    const { api, unmount } = mountDrawers();

    await api.suppressDrawerSelectionClearTemporarily(() => {
      api.onClipPropertiesDrawerClose();
    });

    expect(mockTimelineStore.clearSelection).not.toHaveBeenCalled();
    expect(api.suppressDrawerSelectionClear.value).toBe(false);
    unmount();
  });

  it('opens the virtual clip preset drawer with the requested type', async () => {
    const { api, unmount } = mountDrawers();

    api.onOpenVirtualClipPreset('shape');
    expect(api.virtualClipPresetType.value).toBe('shape');

    await nextTick();
    expect(api.isVirtualClipPresetDrawerOpen.value).toBe(true);
    unmount();
  });
});
