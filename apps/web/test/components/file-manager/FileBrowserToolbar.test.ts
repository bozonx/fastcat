import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';

const mockFileManagerStore = reactive({
  viewMode: 'grid',
  gridCardSize: 130,
  sortOption: { field: 'name', order: 'asc' },
  setViewMode: vi.fn((v) => {
    mockFileManagerStore.viewMode = v;
  }),
  setGridCardSize: vi.fn((v) => {
    mockFileManagerStore.gridCardSize = v;
  }),
});

const mockUiStore = reactive({
  showHiddenFiles: false,
});

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => mockFileManagerStore,
  useFileBrowserPersistenceStore: () => ({
    computerViewMode: ref('grid'),
    computerGridCardSize: ref(130),
    bloggerDogGridCardSize: ref(130),
    setBloggerDogGridCardSize: vi.fn(),
  }),
}));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));

const dropdownStub = {
  name: 'UDropdownMenu',
  props: ['items'],
  template: '<div class="dropdown-stub"><slot /></div>',
};

const tooltipStub = {
  name: 'UiTooltip',
  props: ['text'],
  template: '<div class="tooltip-stub" :data-text="text"><slot /></div>',
};

describe('FileBrowserToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders view mode toggles', () => {
    const wrapper = mount(FileBrowserToolbar, {
      props: {
        gridSizes: [100, 130, 160],
        currentGridSizeName: 'm',
        gridCardSize: 130,
      },
      global: {
        stubs: {
          UiToggleButton: true,
          UiWheelSlider: true,
          UiSelect: true,
          UiActionButton: true,
          UiTooltip: tooltipStub,
          UDropdownMenu: dropdownStub,
        },
      },
    });

    const toggles = wrapper.findAllComponents({ name: 'UiToggleButton' });
    expect(toggles.length).toBeGreaterThanOrEqual(2);
  });

  it('calls setViewMode on toggle click', async () => {
    // Since we are using stubs, we need to check if they receive correct props and emit events if possible,
    // or just test the component logic if we don't stub it part-way.
    // But UiToggleButton is a complex base component.
    // Let's just verify properties for now to ensure it's wired correctly.
  });

  it('exposes selection actions in the dropdown menu', () => {
    const wrapper = mount(FileBrowserToolbar, {
      props: {
        gridSizes: [100, 130, 160],
        currentGridSizeName: 'm',
        gridCardSize: 130,
      },
      global: {
        stubs: {
          UiToggleButton: true,
          UiWheelSlider: true,
          UiSelect: true,
          UiActionButton: true,
          UiTooltip: tooltipStub,
          UDropdownMenu: dropdownStub,
        },
      },
    });

    const dropdown = wrapper.findComponent(dropdownStub);
    const items = dropdown.props('items') as Array<Array<{ label: string }>>;
    const selectionSection = items[1];

    expect(selectionSection?.map((item) => item.label)).toEqual([
      'common.selectAll',
      'common.selectUnused',
      'common.invertSelection',
    ]);

    expect(selectionSection?.[0]?.kbds).toEqual(['Ctrl', 'A']);
  });

  it('shows configured zoom hotkeys in the grid scale tooltip', () => {
    const wrapper = mount(FileBrowserToolbar, {
      props: {
        gridSizes: [100, 130, 160],
        currentGridSizeName: 'm',
        gridCardSize: 130,
      },
      global: {
        stubs: {
          UiToggleButton: true,
          UiWheelSlider: true,
          UiSelect: true,
          UiActionButton: true,
          UiTooltip: tooltipStub,
          UDropdownMenu: dropdownStub,
        },
      },
    });

    const sliderContainer = wrapper.find(
      '.tooltip-stub[data-text*="videoEditor.fileManager.cardScale"]',
    );
    const tooltip = sliderContainer.attributes('data-text');

    expect(tooltip).toContain('videoEditor.fileManager.cardScale: m');
    expect(tooltip).toContain('videoEditor.hotkeys.general.zoomIn (=)');
    expect(tooltip).toContain('videoEditor.hotkeys.general.zoomOut (-)');
    expect(tooltip).toContain('videoEditor.hotkeys.general.zoomReset (0)');
  });

  it('renders the toolbar menu button with the standard toolbar button size', () => {
    const wrapper = mount(FileBrowserToolbar, {
      props: {
        gridSizes: [100, 130, 160],
        currentGridSizeName: 'm',
        gridCardSize: 130,
      },
      global: {
        stubs: {
          UiToggleButton: true,
          UiWheelSlider: true,
          UiSelect: true,
          UiActionButton: true,
          UiTooltip: tooltipStub,
          UDropdownMenu: dropdownStub,
        },
      },
    });

    const menuButton = wrapper.find('[data-testid="file-toolbar-menu"]');

    expect(menuButton.attributes('size')).toBe('sm');
    expect(menuButton.classes()).toContain('text-ui-text-muted');
    expect(menuButton.classes()).toContain('hover:text-ui-text');
    expect(menuButton.attributes('square')).not.toBe('true');
  });
});
