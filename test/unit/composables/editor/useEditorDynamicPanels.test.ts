import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useEditorDynamicPanels } from '~/composables/editor/useEditorDynamicPanels';

const mockProjectStore = {
  cutPanels: [{ id: 'col1', panels: [{ id: 'panel1', type: 'media', filePath: '/test.mp4' }] }],
  soundPanels: [{ id: 'col2', panels: [{ id: 'panel2', type: 'effects' }] }],
  currentView: 'cut',
  setView: vi.fn(),
  removePanel: vi.fn(),
  insertPanelAt: vi.fn(),
  addTextPanel: vi.fn(),
  addMediaPanel: vi.fn(),
  movePanel: vi.fn(),
};

const mockFocusStore = {
  effectiveFocus: 'dynamic:panel1',
  setPanelFocus: vi.fn(),
  restoreLastCutMainPanel: vi.fn(),
};

const mockTabsStore = {
  showStaticTab: vi.fn(),
  hideStaticTab: vi.fn(),
};

const mockFileManager = {
  findEntryByPath: vi.fn(),
  vfs: {},
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => mockFocusStore,
}));

vi.mock('~/stores/tabs.store', () => ({
  useProjectTabsStore: () => mockTabsStore,
}));

vi.mock('~/composables/fileManager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

let mockLocalStorage: Record<string, any> = {};

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  readLocalStorageJson: vi.fn((key, def) => mockLocalStorage[key] ?? def),
  writeLocalStorageJson: vi.fn((key, val) => {
    mockLocalStorage[key] = val;
  }),
}));

vi.mock('~/utils/media-types', () => ({
  isOpenableProjectFileName: vi.fn().mockReturnValue(true),
}));

describe('useEditorDynamicPanels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage = {};
    mockProjectStore.cutPanels = [
      { id: 'col1', panels: [{ id: 'panel1', type: 'media', filePath: '/test.mp4' } as any] },
    ];
    mockProjectStore.soundPanels = [
      { id: 'col2', panels: [{ id: 'panel2', type: 'effects' } as any] },
    ];
  });

  const createDragEvent = (overrides = {}): DragEvent => ({
    preventDefault: vi.fn(),
    dataTransfer: {
      effectAllowed: 'uninitialized',
      setData: vi.fn(),
      getData: vi.fn(),
      types: [],
    },
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      contains: vi.fn().mockReturnValue(false),
    },
    relatedTarget: null,
    clientX: 10,
    clientY: 10,
    ...overrides,
  } as unknown as DragEvent);

  it('computes layout keys correctly', () => {
    const projectId = ref('test-proj');
    const { cutPanelsLayoutKey, soundPanelsLayoutKey } = useEditorDynamicPanels({
      currentProjectId: projectId,
    });

    expect(cutPanelsLayoutKey.value).toBe(JSON.stringify([{ id: 'col1', rows: ['panel1'] }]));
    expect(soundPanelsLayoutKey.value).toBe(JSON.stringify([{ id: 'col2', rows: ['panel2'] }]));
  });

  it('identifies panel view correctly', () => {
    const projectId = ref('test-proj');
    const { getPanelView } = useEditorDynamicPanels({ currentProjectId: projectId });

    expect(getPanelView('panel1')).toBe('cut');
    expect(getPanelView('panel2')).toBe('sound');
    expect(getPanelView('unknown-panel')).toBeNull();
  });

  it('gets active detached panel from focus store', () => {
    const projectId = ref('test-proj');
    const { getActiveDetachedPanel } = useEditorDynamicPanels({ currentProjectId: projectId });

    mockFocusStore.effectiveFocus = 'dynamic:panel1';
    const panel = getActiveDetachedPanel();
    expect(panel).not.toBeNull();
    expect(panel?.id).toBe('panel1');

    mockFocusStore.effectiveFocus = 'something-else';
    expect(getActiveDetachedPanel()).toBeNull();
  });

  it('focuses dynamic panel correctly', () => {
    const projectId = ref('test-proj');
    const { focusDynamicPanel, getDynamicPanelFocusId } = useEditorDynamicPanels({
      currentProjectId: projectId,
    });

    expect(getDynamicPanelFocusId('panel1')).toBe('dynamic:panel1');

    focusDynamicPanel('panel1');
    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('dynamic:panel1');
  });

  it('closes panel and restores tab', () => {
    const projectId = ref('test-proj');
    const { closePanelAndRestoreTab } = useEditorDynamicPanels({ currentProjectId: projectId });

    const panelToClose = { id: 'panel2', type: 'effects' } as any;
    closePanelAndRestoreTab(panelToClose, { restoreFocus: true, view: 'cut' });

    expect(mockTabsStore.showStaticTab).toHaveBeenCalledWith('effects');
    expect(mockProjectStore.removePanel).toHaveBeenCalledWith('panel2', 'cut');
    expect(mockFocusStore.restoreLastCutMainPanel).toHaveBeenCalled();
  });

  it('moves panel to another view', () => {
    const projectId = ref('test-proj');
    const { movePanelToView } = useEditorDynamicPanels({ currentProjectId: projectId });

    const panelToMove = { id: 'panel1', type: 'media', filePath: '/test.mp4' } as any;
    movePanelToView(panelToMove, 'sound');

    expect(mockProjectStore.removePanel).toHaveBeenCalledWith('panel1', 'cut');
    expect(mockProjectStore.insertPanelAt).toHaveBeenCalledWith(
      { ...panelToMove },
      undefined,
      undefined,
      'sound'
    );
    expect(mockProjectStore.setView).toHaveBeenCalledWith('sound');
    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('dynamic:panel1');
  });

  describe('Drag and Drop', () => {
    it('handles drag start for valid media panel', () => {
      const projectId = ref('test-proj');
      const { onDragStart, draggingPanelId } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      const event = createDragEvent();
      onDragStart(event, 'panel1');

      expect(draggingPanelId.value).toBe('panel1');
      expect(event.dataTransfer?.setData).toHaveBeenCalledWith(
        'panel-drag',
        JSON.stringify({ panelId: 'panel1', filePath: '/test.mp4', fileName: 'test.mp4' })
      );
    });

    it('handles drag over to set dropPosition', () => {
      const projectId = ref('test-proj');
      const { onDragStart, onDragOver, dragOverPanelId, dropPosition } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      const startEvent = createDragEvent();
      onDragStart(startEvent, 'panel1'); // set dragging state

      const overEvent = createDragEvent({
        dataTransfer: { types: ['panel-drag'] },
        clientX: 10,
        clientY: 50, // closer to left (10) than top/bottom
      });

      onDragOver(overEvent, 'panel2');

      expect(overEvent.preventDefault).toHaveBeenCalled();
      expect(dragOverPanelId.value).toBe('panel2');
      // depending on bounding box (100x100) and threshold (30):
      // left = 10, right = 90, top = 50, bottom = 50. Min is left (10).
      expect(dropPosition.value).toBe('left');
    });

    it('resets drag state on end and leave', () => {
      const projectId = ref('test-proj');
      const { onDragStart, onDragOver, onDragLeave, onDragEnd, draggingPanelId, dropPosition } =
        useEditorDynamicPanels({ currentProjectId: projectId });

      onDragStart(createDragEvent(), 'panel1');
      onDragOver(createDragEvent({ clientX: 10, clientY: 50 }), 'panel2');
      expect(draggingPanelId.value).toBe('panel1');

      onDragLeave(createDragEvent(), 'panel2');
      expect(dropPosition.value).toBeNull();

      onDragEnd();
      expect(draggingPanelId.value).toBeNull();
    });
  });

  describe('Vertical Split Resizing', () => {
    it('saves vertical split sizes on resize', () => {
      const projectId = ref('test-proj');
      const { onVerticalSplitResize, getVerticalSize } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      onVerticalSplitResize({
        event: [{ size: 30 }, { size: 70 }],
        colId: 'col1',
        view: 'cut',
      });

      // Should save to mockLocalStorage
      expect(mockLocalStorage[`fastcat-cut-vertical-splits-test-proj`]).toEqual({
        col1: [30, 70],
      });

      expect(getVerticalSize({ colId: 'col1', rowIndex: 1, totalRows: 2, view: 'cut' })).toBe(70);
    });

    it('returns undefined if rows count mismatches saved config', () => {
      const projectId = ref('test-proj');
      const { onVerticalSplitResize, getVerticalSize } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      onVerticalSplitResize({
        event: [{ size: 50 }, { size: 50 }],
        colId: 'col1',
        view: 'sound',
      });

      // Mismatch
      expect(getVerticalSize({ colId: 'col1', rowIndex: 0, totalRows: 3, view: 'sound' })).toBeUndefined();
    });
  });
});
