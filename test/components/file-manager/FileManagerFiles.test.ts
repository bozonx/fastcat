import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref, reactive, nextTick } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';

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

vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    mediaPathToTimelines: {},
    setLiveUsage: vi.fn(),
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

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: {
      hotkeys: {
        layer1: 'Shift',
        layer2: 'Control',
        bindings: {},
      },
      timeline: {
        defaultStaticClipDurationUs: 5000000,
      },
    },
  })),
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
    return mockUiStore;
  },
}));

function createFmProps(params: {
  rootEntries?: any[];
  getProjectRootDirHandle?: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  const getProjectRootDirHandle =
    params.getProjectRootDirHandle ??
    vi.fn(async () => ({}) as unknown as FileSystemDirectoryHandle);

  return {
    isDragging: false,
    isLoading: false,
    isApiSupported: true,
    rootEntries: params.rootEntries ?? [],
    getFileIcon: () => 'i-heroicons-document',
    findEntryByPath: (path: string) =>
      (params.rootEntries ?? []).find((e) => e.path === path) || null,
    resolveEntryByPath: vi.fn(async (path: string) =>
      (params.rootEntries ?? []).find((e) => e.path === path) || null,
    ),
    mediaCache: { hasProxy: () => false },
    moveEntry: async () => {},
    copyEntry: async () => {},
    getProjectRootDirHandle,
    handleFiles: async () => {},
  };
}

async function createWrapper(params: {
  projectName: string;
  rootEntries?: any[];
  getProjectRootDirHandle?: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  mockUiStore.selectedFsEntry = null;
  mockUiStore.fileTreeSelectAllTrigger = 0;
  mockSelectionStore.selectedEntity = null;

  const fmProps = createFmProps(params);

  const Harness = defineComponent({
    setup() {
      useEditorHotkeys();
      return () => h(FileManagerFiles, fmProps as any);
    },
  });

  return await mountSuspended(Harness, {
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
    const focusStore = useFocusStore();
    const initialTrigger = uiStore.fileTreeSelectAllTrigger;

    focusStore.setPanelFocus('left');
    await nextTick();
    await nextTick();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await nextTick();

    expect(uiStore.fileTreeSelectAllTrigger).toBe(initialTrigger + 1);
  });

  it('falls back to resolveEntryByPath for move requests when source is absent in loaded tree', async () => {
    const sourceEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: 'folder/clip.mp4',
    };
    const moveEntry = vi.fn(async () => {});
    const resolveEntryByPath = vi.fn(async (path: string) =>
      path === sourceEntry.path ? (sourceEntry as any) : null,
    );

    const wrapper = await mountSuspended(FileManagerFiles, {
      props: {
        ...createFmProps({}),
        rootEntries: [{ name: 'folder', kind: 'directory', path: 'folder' }],
        moveEntry,
        resolveEntryByPath,
      } as any,
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
          FileManagerTree: {
            template:
              '<button data-test="tree-move" @click="$emit(\'requestMove\', { sourcePath: \'folder/clip.mp4\', targetDirPath: \'target\' })" />',
          },
        },
      },
    });

    await wrapper.get('[data-test="tree-move"]').trigger('click');

    expect(resolveEntryByPath).toHaveBeenCalledWith(sourceEntry.path);
    expect(moveEntry).toHaveBeenCalledWith({
      source: sourceEntry,
      targetDirPath: 'target',
    });
  });
});
