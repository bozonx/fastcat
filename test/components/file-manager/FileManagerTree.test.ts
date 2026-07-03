import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import FileManagerTree from '~/components/file-manager/FileManagerTree.vue';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import { getDndZone, clearDndZones, DND_ZONE_ATTR } from '~/composables/dnd/dndRegistry';
import type { DndDragContext } from '~/composables/dnd/dndTypes';

const {
  INTERNAL_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
  FILE_MANAGER_ITEMS_DRAG_TYPE,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} = vi.hoisted(() => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-internal-file',
  REMOTE_FILE_DRAG_TYPE: 'application/fastcat-remote-file',
  FILE_MANAGER_ITEMS_DRAG_TYPE: 'application/fastcat-file-manager-items',
  FILE_MANAGER_COPY_DRAG_TYPE: 'application/fastcat-file-manager-copy',
  FILE_MANAGER_MOVE_DRAG_TYPE: 'application/fastcat-file-manager-move',
}));

const mockState = vi.hoisted(() => ({
  dragSourceFileManagerInstanceId: null as string | null,
  currentDragOperation: null as 'copy' | 'move' | 'cancel' | null,
  draggedItems: [] as any[],
  setCurrentDragOperation: vi.fn(),
  setDragSourceFileManagerInstanceId: vi.fn(),
  setDragTargetFileManagerInstanceId: vi.fn(),
  setDragSourceVfs: vi.fn(),
}));

// Link mock functions to state updates
mockState.setCurrentDragOperation.mockImplementation((op: any) => {
  mockState.currentDragOperation = op;
});
mockState.setDragSourceFileManagerInstanceId.mockImplementation((id: any) => {
  mockState.dragSourceFileManagerInstanceId = id;
});

const selectionStoreMock = {
  selectedEntity: null as any,
  selectFsEntries: vi.fn(),
  clearSelection: vi.fn(),
};

const uiStoreMock = reactive({
  isFileManagerDragging: false,
  setFileTreePathExpanded: vi.fn(),
});

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {},
    },
    integrations: {
      fastcatAccount: { enabled: false, bearerToken: '' },
      fastcatPublicador: { enabled: false, bearerToken: '' },
      manualFilesApi: { enabled: false, baseUrl: '', bearerToken: '', overrideFastCat: false },
    },
  },
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
};

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: { bloggerDogApiUrl: '' },
  }),
}));

vi.stubGlobal('useToast', () => ({ add: vi.fn() }));

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: () => 'video',
  isOpenableProjectFileName: () => false,
  VIDEO_EXTENSIONS: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  AUDIO_EXTENSIONS: ['mp3', 'wav'],
  IMAGE_EXTENSIONS: ['jpg', 'png'],
  TEXT_EXTENSIONS: ['txt', 'md'],
  TIMELINE_EXTENSIONS: ['otio'],
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => ({
    getProxyPath: vi.fn(),
    isProxyGenerating: vi.fn(),
    getProxyProgress: vi.fn(),
    generatingProxies: new Set(),
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStoreMock,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    hasFileManagerPayload: false,
    get currentDragOperation() {
      return mockState.currentDragOperation;
    },
    get dragSourceFileManagerInstanceId() {
      return mockState.dragSourceFileManagerInstanceId;
    },
    setCurrentDragOperation: mockState.setCurrentDragOperation,
    setDragSourceFileManagerInstanceId: mockState.setDragSourceFileManagerInstanceId,
    setDragTargetFileManagerInstanceId: mockState.setDragTargetFileManagerInstanceId,
    setDragSourceVfs: mockState.setDragSourceVfs,
    setDraggedItems: vi.fn((items) => {
      mockState.draggedItems = items;
    }),
    clearDraggedItems: vi.fn(() => {
      mockState.draggedItems = [];
    }),
    get draggedItems() {
      return mockState.draggedItems;
    },
  }),
}));

vi.mock('~/composables/useDraggedFile', () => ({
  INTERNAL_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
  FILE_MANAGER_ITEMS_DRAG_TYPE,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  useDraggedFile: () => ({
    draggedFile: null,
    setDraggedFile: vi.fn(),
    clearDraggedFile: vi.fn(),
  }),
}));

function mountTree(entries: FsEntry[], instanceId = 'main') {
  return mount(FileManagerTree, {
    props: {
      entries,
      depth: 0,
      instanceId,
    },
  });
}

/** Resolve the pointer-DnD drop zone the root tree registered on mount. */
function getTreeZone(wrapper: ReturnType<typeof mountTree>) {
  const zoneId = wrapper.find('ul').attributes(DND_ZONE_ATTR);
  expect(zoneId).toBeTruthy();
  const zone = getDndZone(zoneId!);
  expect(zone).toBeTruthy();
  return zone!;
}

/** Build a drag context targeting a given entry row, as the engine would. */
function dropCtx(
  wrapper: ReturnType<typeof mountTree>,
  targetPath: string,
  items: any[],
  modifiers: Partial<DndDragContext['pointer']> = {},
): DndDragContext {
  const targetEl = wrapper.find(`[data-entry-path="${targetPath}"]`).element;
  return {
    payload: { source: 'file-manager', data: { items, sourceInstanceId: null } },
    pointer: {
      clientX: 0,
      clientY: 0,
      pointerType: 'mouse',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
    },
    zoneId: 'tree',
    targetEl,
    setOperation: vi.fn(),
  };
}

describe('FileManagerTree', () => {
  beforeEach(() => {
    selectionStoreMock.selectedEntity = null;
    selectionStoreMock.selectFsEntries.mockReset();
    selectionStoreMock.clearSelection.mockReset();
    mockState.dragSourceFileManagerInstanceId = null;
    mockState.currentDragOperation = null;
    mockState.draggedItems = [];
    mockState.setCurrentDragOperation.mockClear();
    mockState.setDragSourceFileManagerInstanceId.mockClear();
    mockState.setDragTargetFileManagerInstanceId.mockClear();
    mockState.setDragSourceVfs.mockClear();
    uiStoreMock.isFileManagerDragging = false;
    clearDndZones();
  });

  it('renders root entries', () => {
    const rootEntries: FsEntry[] = [
      { name: '_video', kind: 'directory', path: '_video', expanded: false },
    ];
    const wrapper = mountTree(rootEntries);
    expect(wrapper.text()).toContain('_video');
  });

  it('renders nested children when expanded', () => {
    const rootEntries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: true,
        children: [
          {
            name: 'child.mp4',
            kind: 'file',
            path: '_video/child.mp4',
            parentPath: '_video',
            expanded: false,
          },
        ],
      },
    ];
    const wrapper = mountTree(rootEntries);
    expect(wrapper.text()).toContain('_video');
    expect(wrapper.text()).toContain('child.mp4');
  });

  it('does not render a chevron for a loaded empty directory', () => {
    const wrapper = mountTree([
      {
        name: 'empty',
        kind: 'directory',
        path: 'empty',
        expanded: true,
        children: [],
        hasChildren: true,
      },
    ]);

    expect(wrapper.find('[data-entry-path="empty"] .i-heroicons-chevron-right').exists()).toBe(
      false,
    );
  });

  it('emits requestMove on internal move drop', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const items = [{ name: 'a.mp4', kind: 'file', path: '_audio/a.mp4' }];
    mockState.draggedItems = items;

    await getTreeZone(wrapper).onDrop!(dropCtx(wrapper, '_video', items));

    expect(wrapper.emitted('requestMove')?.[0]?.[0]).toEqual({
      sourcePath: '_audio/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('emits requestCopy on internal copy drop (layer-1 held)', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const items = [{ name: 'a.mp4', kind: 'file', path: '_audio/a.mp4' }];
    mockState.draggedItems = items;

    // layer1 (Shift) → copy.
    await getTreeZone(wrapper).onDrop!(dropCtx(wrapper, '_video', items, { shiftKey: true }));

    expect(wrapper.emitted('requestCopy')?.[0]?.[0]).toEqual({
      sourcePath: '_audio/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('opens the target folder after an internal move drop', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const items = [{ name: 'a.mp4', kind: 'file', path: '_audio/a.mp4' }];
    mockState.draggedItems = items;

    await getTreeZone(wrapper).onDrop!(dropCtx(wrapper, '_video', items));

    expect(uiStoreMock.setFileTreePathExpanded).toHaveBeenCalledWith('_video', true);
    expect(wrapper.emitted('toggle')?.[0]?.[0]).toMatchObject({ path: '_video' });
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ path: '_video' });
  });

  it('cancels tree drop when item is returned onto its own container', async () => {
    mockState.dragSourceFileManagerInstanceId = 'main';
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir], 'main');
    const items = [{ name: '_video', kind: 'directory', path: '_video' }];
    mockState.draggedItems = items;

    await getTreeZone(wrapper).onDrop!(dropCtx(wrapper, '_video', items, { shiftKey: true }));

    expect(wrapper.emitted('requestMove')).toBeFalsy();
    expect(wrapper.emitted('requestCopy')).toBeFalsy();
  });

  it('shows cancel operation on dragover when item returns to its source container', async () => {
    mockState.dragSourceFileManagerInstanceId = 'main';
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir], 'main');

    const items = [{ name: '_video', kind: 'directory', path: '_video' }];
    mockState.draggedItems = items;

    const ctx = dropCtx(wrapper, '_video', items);
    getTreeZone(wrapper).onOver!(ctx);

    expect(mockState.setCurrentDragOperation).toHaveBeenCalledWith('cancel');
    expect(ctx.setOperation).toHaveBeenCalledWith('cancel');
  });

  it('emits requestMove to project root when dropped on the empty space below the tree', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const items = [{ name: 'a.mp4', kind: 'file', path: '_video/a.mp4' }];
    mockState.draggedItems = items;

    const targetEl = wrapper.find('ul > li:last-child > div').element;
    await getTreeZone(wrapper).onDrop!({
      payload: { source: 'file-manager', data: { items, sourceInstanceId: null } },
      pointer: {
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      zoneId: 'tree',
      targetEl,
      setOperation: vi.fn(),
    });

    expect(wrapper.emitted('requestMove')?.[0]?.[0]).toEqual({
      sourcePath: '_video/a.mp4',
      targetDirPath: '',
    });
  });

  it('highlights nested folders while the root drop zone owns the drag state', async () => {
    const entries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: true,
        children: [
          {
            name: 'nested',
            kind: 'directory',
            path: '_video/nested',
            expanded: false,
          },
        ],
      },
    ];
    const wrapper = mountTree(entries, 'main');
    const items = [{ name: 'a.mp4', kind: 'file', path: '_audio/a.mp4' }];
    mockState.draggedItems = items;

    getTreeZone(wrapper).onOver!(dropCtx(wrapper, '_video/nested', items));
    await nextTick();

    const row = wrapper.find('[data-entry-path="_video/nested"]');
    expect(row.classes()).toContain('bg-primary-500/20');
    expect(row.classes()).toContain('outline-primary-500');
  });
});
