import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileManagerFiles from '../../../../src/components/file-manager/FileManagerFiles.vue';
import { setupTestPinia } from '../../../utils/pinia';

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
    params.getProjectRootDirHandle ?? vi.fn(async () => ({} as unknown as FileSystemDirectoryHandle));

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
    const wrapper = createWrapper({ projectName: 'MyProject', rootEntries: [{ name: 'a' }] as any });

    await wrapper.get('.min-w-full.w-max').trigger('pointerdown');

    const uiStore = await import('~/stores/ui.store').then((m) => m.useUiStore());
    const selectionStore = await import('~/stores/selection.store').then((m) => m.useSelectionStore());

    expect(uiStore.selectedFsEntry?.kind).toBe('directory');
    expect(uiStore.selectedFsEntry?.path).toBe('');
    expect(uiStore.selectedFsEntry?.name).toBe('MyProject');

    expect(selectionStore.selectedEntity?.source).toBe('fileManager');
    expect((selectionStore.selectedEntity as any)?.path).toBe('');
  });
});
