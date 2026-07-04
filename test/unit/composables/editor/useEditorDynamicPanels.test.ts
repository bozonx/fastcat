/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useEditorDynamicPanels } from '~/composables/editor/useEditorDynamicPanels';
import { DND_ZONE_ATTR, getDndZone } from '~/composables/dnd/dndRegistry';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';

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
  projectSettings: {
    ui: {
      layout: {
        verticalSplitSizes: {},
      },
    },
  },
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

const mockWorkspaceStore = {
  userSettings: {
    experimentalFeatures: true,
  },
  inDevelopmentFeaturesEnabled: true,
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => mockFocusStore,
}));

vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: () => mockTabsStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

let mockLocalStorage: Record<string, any> = {};

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  getPlatformSuffix: vi.fn(() => ''),
  readLocalStorageJson: vi.fn((key, def) => mockLocalStorage[key] ?? def),
  writeLocalStorageJson: vi.fn((key, val) => {
    mockLocalStorage[key] = val;
  }),
}));

vi.mock('~/utils/media-types', () => ({
  isOpenableProjectFileName: vi.fn().mockReturnValue(true),
  getMediaTypeFromFilename: vi.fn().mockReturnValue('video'),
}));

vi.mock('~/composables/dnd/usePointerDnd', () => ({
  armPointerDnd: vi.fn(),
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

  const createTargetEl = (panelId = 'panel2', panelView = 'cut') =>
    ({
      closest: vi.fn(() => ({
        dataset: { panelId, panelView },
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      })),
    }) as unknown as Element;

  const createDndContext = (payload: DndPayload, overrides: Partial<DndDragContext> = {}) =>
    ({
      payload,
      pointer: {
        clientX: 10,
        clientY: 50,
        pointerType: 'mouse',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      zoneId: 'zone',
      targetEl: createTargetEl(),
      setOperation: vi.fn(),
      ...overrides,
    }) satisfies DndDragContext;

  function getPanelHandlers() {
    const projectId = ref('test-proj');
    const result = useEditorDynamicPanels({ currentProjectId: projectId });
    const zoneId = result.panelDndZoneAttrs[DND_ZONE_ATTR]!;
    const handlers = getDndZone(zoneId);
    expect(handlers).not.toBeNull();
    return { ...result, handlers: handlers! };
  }

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

    mockFocusStore.effectiveFocus = 'dynamic:media:panel1';
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

    expect(getDynamicPanelFocusId('panel1')).toBe('dynamic:media:panel1');

    focusDynamicPanel('panel1');
    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('dynamic:media:panel1');
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
      'sound',
    );
    expect(mockProjectStore.setView).toHaveBeenCalledWith('sound');
    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('dynamic:media:panel1');
  });

  describe('Drag and Drop', () => {
    it('arms pointer DnD for a valid media panel', () => {
      const projectId = ref('test-proj');
      const { onPanelPointerDown } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      const event = { button: 0 } as PointerEvent;
      onPanelPointerDown(event, 'panel1');

      expect(armPointerDnd).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          payload: expect.objectContaining({
            source: 'panel',
            data: expect.objectContaining({
              panelId: 'panel1',
              panelType: 'media',
              filePath: '/test.mp4',
              fileName: 'test.mp4',
            }),
          }),
        }),
      );
    });

    it('handles pointer DnD over to set dropPosition', () => {
      const { handlers, dragOverPanelId, dropPosition } = getPanelHandlers();

      const ctx = createDndContext({
        source: 'panel',
        data: { panelId: 'panel1', panelType: 'media' },
      });
      handlers.onOver?.(ctx);

      expect(dragOverPanelId.value).toBe('panel2');
      expect(dropPosition.value).toBe('left');
      expect(ctx.setOperation).toHaveBeenCalledWith('move');
    });

    it('resets drag state on end and leave', () => {
      const { handlers, dragOverPanelId, dropPosition } = getPanelHandlers();

      handlers.onOver?.(
        createDndContext({
          source: 'panel',
          data: { panelId: 'panel1', panelType: 'media' },
        }),
      );
      expect(dragOverPanelId.value).toBe('panel2');

      handlers.onLeave?.(
        createDndContext({
          source: 'panel',
          data: { panelId: 'panel1', panelType: 'media' },
        }),
      );
      expect(dropPosition.value).toBeNull();
    });

    it('ignores pointer DnD start when experimentalFeatures is off', () => {
      mockWorkspaceStore.userSettings.experimentalFeatures = false;
      mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
      const projectId = ref('test-proj');
      const { onPanelPointerDown, draggingPanelId } = useEditorDynamicPanels({
        currentProjectId: projectId,
      });

      onPanelPointerDown({ button: 0 } as PointerEvent, 'panel1');

      expect(draggingPanelId.value).toBeNull();
      expect(armPointerDnd).not.toHaveBeenCalled();
    });

    it('rejects panel drop zones when experimentalFeatures is off', () => {
      mockWorkspaceStore.userSettings.experimentalFeatures = false;
      mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
      const { handlers } = getPanelHandlers();

      expect(
        handlers.canAccept?.({
          source: 'panel',
          data: { panelId: 'panel1', panelType: 'media' },
        }),
      ).toBe(false);
    });

    it('opens static project tabs as panels on drop', async () => {
      const { handlers } = getPanelHandlers();

      await handlers.onDrop?.(
        createDndContext({
          source: 'project-tab',
          data: { kind: 'static-tab', tabId: 'history', label: 'History' },
        }),
      );

      expect(mockProjectStore.insertPanelAt).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'history', title: 'History' }),
        'panel2',
        'left',
        'cut',
      );
      expect(mockTabsStore.hideStaticTab).toHaveBeenCalledWith('history');
    });

    it('opens file project tabs as media panels on drop', async () => {
      const { handlers } = getPanelHandlers();

      await handlers.onDrop?.(
        createDndContext({
          source: 'project-tab',
          data: {
            kind: 'file-tab',
            tabId: 'file-tab-1',
            filePath: '/clip.mp4',
            fileName: 'clip.mp4',
            mediaType: 'video',
          },
        }),
      );

      expect(mockProjectStore.insertPanelAt).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'media',
          filePath: '/clip.mp4',
          mediaType: 'video',
          title: 'clip.mp4',
        }),
        'panel2',
        'left',
        'cut',
      );
    });

    it('moves panels on panel payload drop', async () => {
      const { handlers } = getPanelHandlers();

      await handlers.onDrop?.(
        createDndContext({
          source: 'panel',
          data: { panelId: 'panel1', panelType: 'media' },
        }),
      );

      expect(mockProjectStore.movePanel).toHaveBeenCalledWith('panel1', 'panel2', 'left', 'cut');
    });

    it('opens file-manager payloads as panels on drop', async () => {
      const { handlers } = getPanelHandlers();

      await handlers.onDrop?.(
        createDndContext({
          source: 'file-manager',
          data: { items: [{ kind: 'file', name: 'clip.mp4', path: '/clip.mp4' }] },
        }),
      );

      expect(mockProjectStore.addMediaPanel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'clip.mp4', path: '/clip.mp4' }),
        'video',
        'clip.mp4',
        'panel2',
        'left',
        'cut',
      );
    });
  });

  afterEach(() => {
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
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

      // Should save to projectStore
      expect(
        mockProjectStore.projectSettings.ui.layout.verticalSplitSizes[
          `fastcat-cut-vertical-splits-test-proj`
        ],
      ).toEqual({
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
      expect(
        getVerticalSize({ colId: 'col1', rowIndex: 0, totalRows: 3, view: 'sound' }),
      ).toBeUndefined();
    });
  });
});
