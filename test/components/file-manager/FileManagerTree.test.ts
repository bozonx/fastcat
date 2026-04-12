import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import FileManagerTree from '~/components/file-manager/FileManagerTree.vue';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

const {
  INTERNAL_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} = vi.hoisted(() => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-internal-file',
  REMOTE_FILE_DRAG_TYPE: 'application/fastcat-remote-file',
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
mockState.setCurrentDragOperation.mockImplementation((op: any) => { mockState.currentDragOperation = op; });
mockState.setDragSourceFileManagerInstanceId.mockImplementation((id: any) => { mockState.dragSourceFileManagerInstanceId = id; });

const selectionStoreMock = {
  selectedEntity: null as any,
  selectFsEntries: vi.fn(),
  clearSelection: vi.fn(),
};

const uiStoreMock = reactive({
  fileTreeSelectAllTrigger: 0,
  isFileManagerDragging: false,
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
    get currentDragOperation() { return mockState.currentDragOperation; },
    get dragSourceFileManagerInstanceId() { return mockState.dragSourceFileManagerInstanceId; },
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
    uiStoreMock.fileTreeSelectAllTrigger = 0;
    uiStoreMock.isFileManagerDragging = false;
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
          { name: 'child.mp4', kind: 'file', path: '_video/child.mp4', parentPath: '_video', expanded: false },
        ],
      },
    ];
    const wrapper = mountTree(rootEntries);
    expect(wrapper.text()).toContain('_video');
    expect(wrapper.text()).toContain('child.mp4');
  });

  it('emits requestMove on internal move drop', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');
    const mockEvent = {
      dataTransfer: {
        types: [FILE_MANAGER_MOVE_DRAG_TYPE],
        getData: vi.fn((type) => {
          if (type === FILE_MANAGER_MOVE_DRAG_TYPE) return JSON.stringify({ path: '_audio/a.mp4' });
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;
    await dropzone?.trigger('drop', mockEvent);
    expect(wrapper.emitted('requestMove')?.[0]?.[0]).toEqual({
      sourcePath: '_audio/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('emits requestCopy on internal copy drop', async () => {
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir]);
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');
    const mockEvent = {
      dataTransfer: {
        types: [FILE_MANAGER_COPY_DRAG_TYPE],
        getData: vi.fn((type) => {
          if (type === FILE_MANAGER_COPY_DRAG_TYPE) return JSON.stringify({ path: '_audio/a.mp4' });
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;
    await dropzone?.trigger('drop', mockEvent);
    expect(wrapper.emitted('requestCopy')?.[0]?.[0]).toEqual({
      sourcePath: '_audio/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('cancels tree drop when item is returned onto its own container', async () => {
    mockState.dragSourceFileManagerInstanceId = 'main';
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir], 'main');
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');
    const mockEvent = {
      shiftKey: true,
      dataTransfer: {
        types: [FILE_MANAGER_COPY_DRAG_TYPE],
        getData: vi.fn((type) => {
          if (type === FILE_MANAGER_COPY_DRAG_TYPE) return JSON.stringify({ path: '_video', kind: 'directory' });
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;
    await dropzone?.trigger('drop', mockEvent);
    expect(wrapper.emitted('requestMove')).toBeFalsy();
    expect(wrapper.emitted('requestCopy')).toBeFalsy();
  });

  it('shows cancel operation on dragover when item returns to its source container', async () => {
    mockState.dragSourceFileManagerInstanceId = 'main';
    const dir: FsEntry = { name: '_video', kind: 'directory', path: '_video', expanded: false };
    const wrapper = mountTree([dir], 'main');
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');

    const draggedItem = { name: '_video', kind: 'directory', path: '_video' };
    mockState.draggedItems = [draggedItem];

    const dataTransfer = {
      types: [FILE_MANAGER_COPY_DRAG_TYPE],
      dropEffect: 'copy',
      getData: vi.fn((type) => {
        if (type === FILE_MANAGER_COPY_DRAG_TYPE) return JSON.stringify(draggedItem);
        return '';
      }),
    };

    await dropzone?.trigger('dragover', {
      dataTransfer,
      preventDefault: vi.fn(),
    } as unknown as DragEvent);

    expect(mockState.setCurrentDragOperation).toHaveBeenCalledWith('cancel');
    expect(dataTransfer.dropEffect).toBe('none');
  });
});
