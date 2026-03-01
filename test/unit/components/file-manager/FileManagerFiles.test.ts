import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileManagerFiles from '../../../../src/components/file-manager/FileManagerFiles.vue';
import { setupTestPinia } from '../../../utils/pinia';
import { useUiStore } from '../../../../src/stores/ui.store';
import { useSelectionStore } from '../../../../src/stores/selection.store';

function createWrapper(params: {
  projectName: string;
  rootEntries?: any[];
  getProjectRootDirHandle?: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  const pinia = setupTestPinia({
    initialState: {
      project: {
        currentProjectName: params.projectName,
      },
      ui: {
        selectedFsEntry: null,
      },
      selection: {
        selectedEntity: null,
      },
    },
  });

  const getProjectRootDirHandle =
    params.getProjectRootDirHandle ??
    vi.fn(async () => ({}) as unknown as FileSystemDirectoryHandle);

  return mount(FileManagerFiles, {
    props: {
      isDragging: false,
      isLoading: false,
      isApiSupported: true,
      rootEntries: params.rootEntries ?? [],
      getFileIcon: () => 'i-heroicons-document',
      findEntryByPath: () => null,
      mediaCache: { hasProxy: () => false },
      moveEntry: async () => {},
      getProjectRootDirHandle,
      handleFiles: async () => {},
    },
    global: {
      plugins: [pinia],
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
    const wrapper = createWrapper({
      projectName: 'MyProject',
      rootEntries: [{ name: 'a' }] as any,
      getProjectRootDirHandle,
    });

    await wrapper.get('.min-w-full.w-max').trigger('pointerdown');

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const uiStore = useUiStore();
    const selectionStore = useSelectionStore();

    expect(getProjectRootDirHandle).toHaveBeenCalledTimes(1);

    expect(uiStore.selectedFsEntry?.kind).toBe('directory');
    expect(uiStore.selectedFsEntry?.path).toBe('');
    expect(uiStore.selectedFsEntry?.name).toBe('MyProject');

    expect(selectionStore.selectedEntity?.source).toBe('fileManager');
    expect((selectionStore.selectedEntity as any)?.path).toBe('');
  });
});
