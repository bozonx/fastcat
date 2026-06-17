import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';
import { reactive } from 'vue';

const mockTimelineStore = reactive({
  markers: [] as any[],
  timelineFormat: { fps: 30 },
  setCurrentTimeUs: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.markers = [];
    mockTimelineStore.timelineFormat = { fps: 30 };
    mockSelectionStore.selectedEntity = null;
    mockSelectionStore.isMarkerSelected.mockReturnValue(false);
  });

  it('renders empty state when no markers', async () => {
    const component = await mountWithNuxt(ProjectMarkers);
    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('videoEditor.fileManager.markers.empty');
  });

  it('renders markers sorted by time', async () => {
    mockTimelineStore.markers = [
      { id: '2', timeUs: 2_000_000, text: 'Second' },
      { id: '1', timeUs: 1_000_000, text: 'First' },
    ];

    const component = await mountWithNuxt(ProjectMarkers);
    const rows = component.findAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0]?.text()).toContain('First');
    expect(rows[1]?.text()).toContain('Second');
  });

  it('filters markers by selected colors', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
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
      { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
      { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
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
      { id: '1', timeUs: 1_000_000, text: 'Default' },
      { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
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

  it('opens export modal on export button click', async () => {
    mockTimelineStore.markers = [{ id: '1', timeUs: 1_000_000, text: 'Marker 1' }];

    const component = await mountWithNuxt(ProjectMarkers);
    const exportButton = component
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.marker.exportAsText'));
    expect(exportButton).toBeDefined();
    expect(component.find('.modal-mock').exists()).toBe(false);

    await exportButton!.trigger('click');
    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('passes vertical orientation to MarkerColorFilter', async () => {
    mockTimelineStore.markers = [
      { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
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
      { id: '1', timeUs: 1_000_000, durationUs: 5_000_000, text: 'Zone Marker' },
      { id: '2', timeUs: 10_000_000, text: 'Point Marker' },
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
});
