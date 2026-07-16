import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick, reactive } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';
import MarkerExportModal from '~/components/project/MarkerExportModal.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const mockTimelineStore = reactive({
  markers: [] as any[],
  timelineFormat: { fps: 30 },
  setCurrentTimeTicks: vi.fn(),
  requestScrollToPlayhead: vi.fn(),
});

const mockSelectionStore = {
  selectedEntity: null as any,
  isMarkerSelected: vi.fn(() => false),
  selectTimelineMarker: vi.fn(),
  selectTimelineMarkers: vi.fn(),
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

vi.mock('~/components/project/MarkerThumbnail.vue', () => ({
  default: { template: '<div class="marker-thumbnail-mock" />' },
}));

describe('ProjectMarkers.vue', () => {
  const workspaceStore = useWorkspaceStore();
  let premiumFeaturesEnabledOriginal: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    premiumFeaturesEnabledOriginal = workspaceStore.premiumFeaturesEnabled ?? false;
    workspaceStore.premiumFeaturesEnabled = true;
    mockTimelineStore.markers = [];
    mockTimelineStore.timelineFormat = { fps: 30 };
    mockSelectionStore.selectedEntity = null;
    mockSelectionStore.isMarkerSelected.mockReturnValue(false);
  });

  afterEach(() => {
    workspaceStore.premiumFeaturesEnabled = premiumFeaturesEnabledOriginal;
  });

  it('renders empty state when no markers', async () => {
    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('videoEditor.fileManager.markers.empty');
  });

  it('renders markers sorted by time', async () => {
    mockTimelineStore.markers = [
      { id: '2', timeTicks: 508_032_000_000, text: 'Second' },
      { id: '1', timeTicks: 254_016_000_000, text: 'First' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0]?.text()).toContain('First');
    expect(rows[1]?.text()).toContain('Second');
  });

  it('sets playhead and requests scroll to playhead on marker click', async () => {
    mockTimelineStore.markers = [{ id: '1', timeTicks: 254_016_000_000, text: 'First' }];

    const component = await mountWithNuxt(ProjectMarkers);
    const row = component.find('tbody tr');
    expect(row.exists()).toBe(true);

    await row.trigger('click');

    expect(mockTimelineStore.setCurrentTimeTicks).toHaveBeenCalledWith(254_016_000_000);
    expect(mockTimelineStore.requestScrollToPlayhead).toHaveBeenCalled();
    expect(mockSelectionStore.selectTimelineMarker).toHaveBeenCalledWith('1');
  });

  it('adds a marker to multi-selection with shift click', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'First' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Second' },
    ];
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'marker',
      markerId: '1',
    };

    const component = await mountWithNuxt(ProjectMarkers);
    const rows = component.findAll('tbody tr');

    await rows[1]!.trigger('click', { shiftKey: true });

    expect(mockSelectionStore.selectTimelineMarkers).toHaveBeenCalledWith(['1', '2']);
    expect(mockSelectionStore.selectTimelineMarker).not.toHaveBeenCalled();
  });

  it('removes a marker from multi-selection with shift click', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'First' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Second' },
    ];
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'markers',
      markerIds: ['1', '2'],
    };

    const component = await mountWithNuxt(ProjectMarkers);
    const rows = component.findAll('tbody tr');

    await rows[0]!.trigger('click', { shiftKey: true });

    expect(mockSelectionStore.selectTimelineMarkers).toHaveBeenCalledWith(['2']);
  });

  it('filters markers by selected colors', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.findAll('tbody tr').length).toBe(2);

    const redButton = component.findAll('button').find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#d0021b');
    });
    expect(redButton).toBeDefined();
    await redButton!.trigger('click');

    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0]?.text()).toContain('Blue');
  });

  it('toggles all colors with select all/reset button', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.findAll('tbody tr').length).toBe(2);

    const toggleAllButton = component
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.marker.selectAll'));
    expect(toggleAllButton).toBeDefined();

    await toggleAllButton!.trigger('click');
    expect(component.findAll('tbody tr').length).toBe(0);

    await toggleAllButton!.trigger('click');
    expect(component.findAll('tbody tr').length).toBe(2);
  });

  it('treats markers without color as default color', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Default' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.findAll('tbody tr').length).toBe(2);

    const defaultButton = component.findAll('button').find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#eab308');
    });
    expect(defaultButton).toBeDefined();
    await defaultButton!.trigger('click');

    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0]?.text()).toContain('Blue');
  });

  it('keeps selected colors in sync when marker colors appear and disappear', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.findAll('tbody tr').length).toBe(1);

    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];
    await nextTick();

    expect(component.findAll('tbody tr').length).toBe(2);

    mockTimelineStore.markers = [
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];
    await nextTick();

    const rows = component.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toContain('Blue');
  });

  it('opens export modal on export button click', async () => {
    mockTimelineStore.markers = [{ id: '1', timeTicks: 254_016_000_000, text: 'Marker 1' }];

    const component = await mountWithNuxt(ProjectMarkers);
    const exportButton = component
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.marker.exportAsText'));
    expect(exportButton).toBeDefined();
    expect(component.find('.modal-mock').exists()).toBe(false);

    await exportButton!.trigger('click');
    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('hides export button when premium features are disabled', async () => {
    workspaceStore.premiumFeaturesEnabled = false;
    mockTimelineStore.markers = [{ id: '1', timeTicks: 254_016_000_000, text: 'Marker 1' }];

    const component = await mountWithNuxt(ProjectMarkers);

    const exportButton = component
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.marker.exportAsText'));
    expect(exportButton).toBeUndefined();
  });

  it('passes vertical orientation to MarkerColorFilter', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
    ];

    const component = await mountWithNuxt(ProjectMarkers, {
      props: {
        colorFilterOrientation: 'vertical',
      },
    });

    const wrapper = component.find('.marker-color-filter');
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.classes()).toContain('flex-col');
    expect(wrapper.classes()).toContain('items-center');
  });

  it('renders stacked end timecode only when duration is present', async () => {
    mockTimelineStore.markers = [
      {
        id: '1',
        timeTicks: 254_016_000_000,
        durationTicks: 1_270_080_000_000,
        text: 'Zone Marker',
      },
      { id: '2', timeTicks: 2_540_160_000_000, text: 'Point Marker' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(2);

    const zoneRow = rows.find((row) => row.text().includes('Zone Marker'))!;
    expect(zoneRow.text()).toContain('00:00:01:00');
    expect(zoneRow.text()).toContain('↳ 00:00:06:00');

    const pointRow = rows.find((row) => row.text().includes('Point Marker'))!;
    expect(pointRow.text()).toContain('00:00:10:00');
    expect(pointRow.text()).not.toContain('↳');
  });

  it('passes selectedColors to MarkerExportModal', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeTicks: 254_016_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeTicks: 508_032_000_000, text: 'Blue', color: '#4a90e2' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);

    // De-select Red by clicking its button
    const redButton = component.findAll('button').find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#d0021b');
    });
    expect(redButton).toBeDefined();
    await redButton!.trigger('click');

    const modal = component.findComponent(MarkerExportModal);
    expect(modal.exists()).toBe(true);

    const filterColorsProp = modal.props('filterColors') as Set<string>;
    expect(filterColorsProp.has('#d0021b')).toBe(false);
    expect(filterColorsProp.has('#4a90e2')).toBe(true);
  });
});
