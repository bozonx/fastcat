import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MarkerExportModal from '~/components/project/MarkerExportModal.vue';

const mockListEntryNames = vi.fn().mockResolvedValue([]);
const mockWriteTextByPath = vi.fn().mockResolvedValue(undefined);

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    listEntryNames: mockListEntryNames,
    writeTextByPath: mockWriteTextByPath,
  }),
}));

describe('MarkerExportModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEntryNames.mockResolvedValue([]);
    mockWriteTextByPath.mockResolvedValue(undefined);
  });

  it('renders export text for markers in default format', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [
          { id: '1', timeUs: 1_000_000, text: 'Intro', color: '#d0021b' },
          { id: '2', timeUs: 5_000_000, text: 'Main', color: '#4a90e2' },
          { id: '3', timeUs: 3661_000_000, text: 'Over Hour', color: '#d0021b' },
        ],
        fps: 30,
        open: true,
      },
    });

    const textarea = component.find('textarea');
    expect(textarea.exists()).toBe(true);
    const text = textarea.element.value;
    expect(text).toContain('00:01 Intro');
    expect(text).toContain('00:05 Main');
    expect(text).toContain('01:01:01 Over Hour');
  });

  it('initializes selected colors from filterColors prop when provided', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [
          { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
          { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
        ],
        fps: 30,
        open: true,
        filterColors: new Set(['#4a90e2']),
      },
    });

    const textarea = component.find('textarea');
    const text = textarea.element.value;
    expect(text).not.toContain('Red');
    expect(text).toContain('Blue');
  });

  it('filters markers by color when color button is clicked', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [
          { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
          { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
        ],
        fps: 30,
        open: true,
      },
    });

    const redButton = component.findAll('button').find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#d0021b');
    });
    expect(redButton).toBeDefined();
    await redButton!.trigger('click');

    const textarea = component.find('textarea');
    const text = textarea.element.value;
    expect(text).not.toContain('Red');
    expect(text).toContain('Blue');
  });

  it('shows selected color with full opacity and unselected with reduced opacity', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [
          { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
          { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
        ],
        fps: 30,
        open: true,
      },
    });

    const buttons = component.findAll('button');
    const redButton = buttons.find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#d0021b');
    });
    const blueButton = buttons.find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#4a90e2');
    });

    expect(redButton!.classes()).toContain('opacity-100');
    expect(blueButton!.classes()).toContain('opacity-100');

    await redButton!.trigger('click');

    expect(redButton!.classes()).toContain('opacity-40');
    expect(blueButton!.classes()).toContain('opacity-100');
  });

  it('formats export text according to selected export format', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [{ id: '1', timeUs: 1_000_000, text: 'Intro', color: '#d0021b' }],
        fps: 30,
        open: true,
      },
    });

    const textarea = component.find('textarea');

    // Default: ms-or-hms-left
    expect(textarea.element.value).toContain('00:01 Intro');

    // Change format via model directly (simulating UiSelect change)
    await component.setProps({ open: true });
    await component.vm.$nextTick();

    const vm = component.vm as any;
    vm.exportFormat = 'hms-left';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('00:00:01 Intro');

    vm.exportFormat = 'timecode-bracket-left';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('[00:00:01:00] Intro');

    vm.exportFormat = 'hms-dash-left';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('00:00:01 - Intro');

    vm.exportFormat = 'hms-right';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('Intro 00:00:01');

    vm.exportFormat = 'timecode-bracket-right';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('Intro [00:00:01:00]');

    vm.exportFormat = 'markdown-bracket-left';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('- [00:01] Intro');

    vm.exportFormat = 'audacity';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('1.000000\t1.000000\tIntro');

    vm.exportFormat = 'csv';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('"Intro","00:00:01:00","","#d0021b"');

    vm.exportFormat = 'tsv';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('"Intro"\t"00:00:01:00"\t""\t"#d0021b"');

    vm.exportFormat = 'json';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('"text": "Intro"');

    vm.exportFormat = 'webvtt';
    await component.vm.$nextTick();

    expect(textarea.element.value).toContain('WEBVTT');
    expect(textarea.element.value).toContain('00:00:01.000 --> 00:00:06.000');
  });

  it('toggles all colors with select all button', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [
          { id: '1', timeUs: 1_000_000, text: 'Red', color: '#d0021b' },
          { id: '2', timeUs: 2_000_000, text: 'Blue', color: '#4a90e2' },
        ],
        fps: 30,
        open: true,
      },
    });

    const toggleAllButton = component
      .findAll('button')
      .find((btn) => btn.text().includes('fastcat.marker.selectAll'));
    expect(toggleAllButton).toBeDefined();

    await toggleAllButton!.trigger('click');
    expect(component.find('textarea').element.value).toBe('');

    await toggleAllButton!.trigger('click');
    expect(component.find('textarea').element.value).toContain('Red');
    expect(component.find('textarea').element.value).toContain('Blue');
  });

  it('uses default color when marker has no color property', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [{ id: '1', timeUs: 1_000_000, text: 'No Color' }],
        fps: 30,
        open: true,
      },
    });

    const defaultButton = component.findAll('button').find((btn) => {
      const style = btn.attributes('style') || '';
      return style.includes('#eab308');
    });
    expect(defaultButton).toBeDefined();

    const textarea = component.find('textarea');
    expect(textarea.element.value).toContain('No Color');
  });

  it('writes export content to _documents/markers.txt via export button', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [{ id: '1', timeUs: 1_000_000, text: 'Intro', color: '#d0021b' }],
        fps: 30,
        open: true,
      },
    });

    const vm = component.vm as any;
    await vm.handleExportToFile();
    await component.vm.$nextTick();

    expect(mockListEntryNames).toHaveBeenCalledWith('_documents');
    expect(mockWriteTextByPath).toHaveBeenCalledWith(
      '_documents/markers.txt',
      expect.any(String),
    );
    expect(mockWriteTextByPath.mock.calls[0]![1]).toContain('Intro');
  });

  it('uses csv extension when csv format is selected', async () => {
    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [{ id: '1', timeUs: 1_000_000, text: 'Intro', color: '#d0021b' }],
        fps: 30,
        open: true,
      },
    });

    const vm = component.vm as any;
    vm.exportFormat = 'csv';
    await component.vm.$nextTick();

    await vm.handleExportToFile();
    await component.vm.$nextTick();

    expect(mockWriteTextByPath).toHaveBeenCalledWith(
      '_documents/markers.csv',
      expect.any(String),
    );
  });

  it('increments filename when markers.txt already exists', async () => {
    mockListEntryNames.mockResolvedValue(['markers.txt']);

    const component = await mountWithNuxt(MarkerExportModal, {
      props: {
        markers: [{ id: '1', timeUs: 1_000_000, text: 'Intro', color: '#d0021b' }],
        fps: 30,
        open: true,
      },
    });

    const vm = component.vm as any;
    await vm.handleExportToFile();
    await component.vm.$nextTick();

    expect(mockWriteTextByPath).toHaveBeenCalledWith(
      '_documents/markers_001.txt',
      expect.any(String),
    );
  });
});
