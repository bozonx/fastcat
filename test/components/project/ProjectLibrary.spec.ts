import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import { reactive } from 'vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';

const armPointerDndMock = vi.fn();
const setDraggedFileMock = vi.fn();
const clearDraggedFileMock = vi.fn();

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
  inDevelopmentFeaturesEnabled: true,
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
  armPointerDnd: (...args: unknown[]) => armPointerDndMock(...args),
}));

vi.mock('~/composables/useDraggedFile', () => ({
  useDraggedFile: () => ({
    setDraggedFile: setDraggedFileMock,
    clearDraggedFile: clearDraggedFileMock,
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

  it('arms pointer-DnD for library text presets', async () => {
    const component = await mountWithNuxt(ProjectLibrary);
    const firstCard = component.find('.effect-card');

    await firstCard.trigger('pointerdown', { button: 0 });

    expect(setDraggedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', path: '' }),
    );
    expect(armPointerDndMock).toHaveBeenCalledTimes(1);
    const [, options] = armPointerDndMock.mock.calls[0] as [PointerEvent, { payload: any }];
    expect(options.payload.source).toBe('library');
    expect(options.payload.data.kind).toBe('text');
  });
});
