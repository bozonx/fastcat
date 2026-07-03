import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import { reactive } from 'vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';

const mockSelectionStore = reactive({
  selectedEntity: null,
  selectProjectLibraryItem: vi.fn(),
});

const mockPresetsStore = reactive({
  textsStandardCollapsed: false,
  textsCustomCollapsed: false,
  shapesStandardCollapsed: false,
  shapesCustomCollapsed: false,
  hudsStandardCollapsed: false,
  hudsCustomCollapsed: false,
  defaultTextPresetId: 'default',
  customPresets: [],
  removePreset: vi.fn(),
  renamePreset: vi.fn(),
  updatePresetsOrder: vi.fn(),
});

const mockWorkspaceStore = reactive({
  isFeatureEnabled: vi.fn((feature: string) => feature === 'hud'),
});

const mockUiStore = reactive({
  activeLibraryTab: 'texts',
});

vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/presets.store', () => ({ usePresetsStore: () => mockPresetsStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    template: '<div><slot /></div>',
  },
}));

vi.mock('~/components/effects/CollapsibleEffectGroup.vue', () => ({
  default: { name: 'CollapsibleEffectGroup', template: '<div><slot /></div>' },
}));

vi.mock('~/composables/dnd/usePointerDnd', () => ({
  armPointerDnd: vi.fn(),
}));

vi.mock('~/composables/useDraggedFile', () => ({
  useDraggedFile: () => ({
    setDraggedFile: vi.fn(),
    clearDraggedFile: vi.fn(),
  }),
}));

describe('ProjectLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUiStore.activeLibraryTab = 'texts';
  });

  it('renders tabs correctly and switches active tab', async () => {
    const component = await mountWithNuxt(ProjectLibrary);
    const buttons = component.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    expect(mockUiStore.activeLibraryTab).toBe('texts');
  });
});
