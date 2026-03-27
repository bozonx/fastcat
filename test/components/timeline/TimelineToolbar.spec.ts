import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';

const mockTimelineStore = reactive({
  isTrimModeActive: false,
  isAnyTrackSoloed: false,
  unsoloAllTracks: vi.fn(),
  addAdjustmentClipAtPlayhead: vi.fn(),
  addBackgroundClipAtPlayhead: vi.fn(),
  addTextClipAtPlayhead: vi.fn(),
  selectTimelineProperties: vi.fn(),
  rippleTrimLeft: vi.fn(),
  rippleTrimRight: vi.fn(),
  selectedItemIds: [] as string[],
  getHotkeyTargetClip: vi.fn((): any => null),
});

const mockSettingsStore = {
  toolbarSnapMode: 'snap',
  toolbarDragMode: 'pseudo_overlap',
  toolbarDragModeEnabled: true,
  selectToolbarSnapMode: vi.fn(),
  cycleToolbarSnapMode: vi.fn(),
  selectToolbarDragMode: vi.fn(),
  toggleSelectedToolbarDragMode: vi.fn(),
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

vi.mock('~/components/ui/UiSplitDropdownButton.vue', () => ({
  default: {
    name: 'UiSplitDropdownButton',
    template: '<button class="mock-dropdown-btn" @click="$emit(\'click\')"><slot /></button>',
    props: ['items', 'icon', 'ariaLabel'],
  },
}));

vi.mock('~/components/ui/UiTooltip.vue', () => ({
  default: {
    name: 'UiTooltip',
    template: '<div><slot /></div>',
    props: ['text'],
  },
}));

describe('TimelineToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.isTrimModeActive = false;
    mockTimelineStore.isAnyTrackSoloed = false;
  });

  it('renders correctly', async () => {
    const component = await mountSuspended(TimelineToolbar);
    expect(component.exists()).toBe(true);
    expect(component.find('[data-timeline-toolbar]').exists()).toBe(true);
  });

  it('toggles trim mode when clicking trim button', async () => {
    const component = await mountSuspended(TimelineToolbar);
    const dropdowns = component.findAllComponents({ name: 'UiSplitDropdownButton' });
    expect(dropdowns.length).toBe(3);

    const trimDropdown = dropdowns[2];
    trimDropdown.vm.$emit('click');

    // Due to the mock component emission, we can also check if the method in the component works
    expect(mockTimelineStore.isTrimModeActive).toBe(true);
  });

  it('shows solo active button when a track is soloed', async () => {
    mockTimelineStore.isAnyTrackSoloed = true;

    const component = await mountSuspended(TimelineToolbar);

    expect(component.text()).toContain('SOLO ACTIVE');

    const buttons = component.findAll('button');
    const unsoloButton = buttons.find((b) => b.text().includes('SOLO ACTIVE'));
    await unsoloButton?.trigger('click');
    expect(mockTimelineStore.unsoloAllTracks).toHaveBeenCalled();
  });

  it('emits dragVirtualStart when dragging virtual clips', async () => {
    const component = await mountSuspended(TimelineToolbar);

    const buttons = component.findAll('button');
    const adjustBtn = buttons.find((b) => b.attributes('draggable') === 'true');
    expect(adjustBtn).toBeDefined();

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: 'uninitialized',
    };

    await adjustBtn!.trigger('dragstart', { dataTransfer });

    expect(component.emitted('dragVirtualStart')).toBeTruthy();
    expect(component.emitted('dragVirtualStart')![0][1]).toBe('adjustment');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/fastcat-virtual-clip',
      'adjustment',
    );
  });

  it('disables ripple trim items when no clip is selected', async () => {
    mockTimelineStore.getHotkeyTargetClip.mockReturnValue(null);
    const component = await mountSuspended(TimelineToolbar);
    const dropdowns = component.findAllComponents({ name: 'UiSplitDropdownButton' });
    const trimDropdown = dropdowns[2];

    const items = trimDropdown.props('items') as any[][];
    const rippleTrimLeft = items[0][0];
    const rippleTrimRight = items[0][1];

    expect(rippleTrimLeft.disabled).toBe(true);
    expect(rippleTrimRight.disabled).toBe(true);
  });

  it('enables ripple trim items when a clip is selected', async () => {
    mockTimelineStore.getHotkeyTargetClip.mockReturnValue({ trackId: 'track1', itemId: 'clip1' });
    const component = await mountSuspended(TimelineToolbar);
    const dropdowns = component.findAllComponents({ name: 'UiSplitDropdownButton' });
    const trimDropdown = dropdowns[2];

    const items = trimDropdown.props('items') as any[][];
    const rippleTrimLeft = items[0][0];
    const rippleTrimRight = items[0][1];

    expect(rippleTrimLeft.disabled).toBe(false);
    expect(rippleTrimRight.disabled).toBe(false);
  });
});
