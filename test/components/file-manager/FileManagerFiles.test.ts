import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import { setupTestPinia } from '../../utils/pinia';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { ref, reactive } from 'vue';

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    currentDragOperation: ref(null),
    hasFileManagerPayload: false,
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    currentProjectName: 'MyProject',
  }),
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({
    setTempFocus: vi.fn(),
  }),
}));

vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    mediaPathToTimelines: {},
  }),
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => ({
    generatingProxies: new Set(),
    proxyProgress: new Map(),
  }),
}));

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    loadTimeline: vi.fn(),
  }),
}));

const mockSelectionStore = reactive({
  selectedEntity: null as any,
  selectFsEntry: vi.fn((entry) => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: entry.kind === 'directory' ? 'directory' : 'file',
      entry,
      path: entry.path,
    };
  }),
  selectFsEntries: vi.fn((entries) => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'multiple',
      entries,
    };
  }),
});
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));

const mockUiStore = reactive({
  selectedFsEntry: null as any,
  fileTreeSelectAllTrigger: 0,
  scrollToFileTreeEntryTrigger: 0,
  scrollToFileTreeEntryPath: null,
  notifyFileManagerUpdate: vi.fn(),
});
vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => {
    // In some contexts, we might need to update the mock state
    return mockUiStore;
  },
}));

async function createWrapper(params: {
  projectName: string;
  rootEntries?: any[];
  getProjectRootDirHandle?: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  mockUiStore.selectedFsEntry = null;
  mockUiStore.fileTreeSelectAllTrigger = 0;
  mockSelectionStore.selectedEntity = null;

  const getProjectRootDirHandle =
    params.getProjectRootDirHandle ??
    vi.fn(async () => ({}) as unknown as FileSystemDirectoryHandle);

  return await mountSuspended(FileManagerFiles, {
    props: {
      isDragging: false,
      isLoading: false,
      isApiSupported: true,
      rootEntries: params.rootEntries ?? [],
      getFileIcon: () => 'i-heroicons-document',
      findEntryByPath: (path: string) =>
        (params.rootEntries ?? []).find((e) => e.path === path) || null,
      mediaCache: { hasProxy: () => false },
      moveEntry: async () => {},
      copyEntry: async () => {},
      getProjectRootDirHandle,
      handleFiles: async () => {},
    },
    global: {
      stubs: {
        UContextMenu: { template: '<div><slot /></div>' },
        UIcon: true,
        FileManagerTree: { template: '<div data-test="tree" />' },
      },
    },
  });
}

describe('FileManagerFiles', () => {
  it('selects project root on background click', async () => {
    const getProjectRootDirHandle = vi.fn(async () => ({}) as unknown as FileSystemDirectoryHandle);
    const wrapper = await createWrapper({
      projectName: 'MyProject',
      rootEntries: [{ name: 'a' }] as any,
      getProjectRootDirHandle,
    });

    await wrapper.get('.min-w-full.w-max').trigger('pointerdown');

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const uiStore = useUiStore();
    const selectionStore = useSelectionStore();

    expect(uiStore.selectedFsEntry?.kind).toBe('directory');
    expect(uiStore.selectedFsEntry?.path).toBe('');
    expect(uiStore.selectedFsEntry?.name).toBe('MyProject');

    expect(selectionStore.selectedEntity?.source).toBe('fileManager');
    expect((selectionStore.selectedEntity as any)?.path).toBe('');
  });

  it('triggers tree select all on ctrl+a', async () => {
    const wrapper = await createWrapper({
      projectName: 'MyProject',
      rootEntries: [{ name: 'a' }] as any,
    });

    const uiStore = useUiStore();
    const initialTrigger = uiStore.fileTreeSelectAllTrigger;

    await wrapper.get('.flex-1.overflow-auto.min-h-0.min-w-0.relative').trigger('keydown', {
      key: 'a',
      ctrlKey: true,
    });

    expect(uiStore.fileTreeSelectAllTrigger).toBe(initialTrigger + 1);
  });
});
