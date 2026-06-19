import { ref, inject } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { DOCUMENTS_DIR_NAME } from '~/utils/constants';

interface CreateDeps {
  createFolder: (name: string, parentPath: string) => Promise<void>;
  createMarkdown: (targetPath?: string) => Promise<string | null>;
  handleFiles: (files: File[], targetPath?: string) => Promise<unknown>;
  loadFolderContent: () => Promise<void>;
}

export function useMobileFileBrowserCreate({
  createFolder,
  createMarkdown,
  handleFiles,
  loadFolderContent,
}: CreateDeps) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();

  const fileInput = ref<HTMLInputElement | null>(null);
  const pendingUploadPath = ref<string | undefined>(undefined);
  const isGlobalUpload = ref(false);
  const isCreateMenuOpen = ref(false);

  async function triggerFileUpload(targetPath?: string) {
    isGlobalUpload.value = false;
    pendingUploadPath.value = targetPath;
    fileInput.value?.click();
  }

  async function triggerGlobalFileUpload() {
    isGlobalUpload.value = true;
    pendingUploadPath.value = undefined;
    fileInput.value?.click();
  }

  function onFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      target.value = '';
      const targetPath = isGlobalUpload.value
        ? undefined
        : (pendingUploadPath.value ?? fileManagerStore.selectedFolder?.path ?? '');
      handleFiles(files, targetPath).then(() => {
        loadFolderContent();
        isCreateMenuOpen.value = false;
      });
      isGlobalUpload.value = false;
      pendingUploadPath.value = undefined;
    }
  }

  async function onCreateFolder(name: string) {
    if (name) {
      const parentPath = fileManagerStore.selectedFolder?.path || '';
      await createFolder(name, parentPath);
      await loadFolderContent();
      isCreateMenuOpen.value = false;
    }
  }

  async function onCreateTextFile(targetPath?: string) {
    const path = await createMarkdown(targetPath);
    if (path) {
      // If targetPath was not provided, use the parent folder of the created file
      // which createMarkdownCommand defaults to DOCUMENTS_DIR_NAME
      const parentPath =
        targetPath ??
        (path.includes('/') ? path.split('/').slice(0, -1).join('/') : DOCUMENTS_DIR_NAME);

      if (fileManagerStore.selectedFolder?.path !== parentPath) {
        const folderName = parentPath.split('/').pop() || 'Documents';
        fileManagerStore.openFolder({
          kind: 'directory',
          name: folderName,
          path: parentPath,
        });
      }

      await loadFolderContent();
      isCreateMenuOpen.value = false;
      return path;
    }
    return null;
  }

  return {
    fileInput,
    pendingUploadPath,
    isGlobalUpload,
    isCreateMenuOpen,
    triggerFileUpload,
    triggerGlobalFileUpload,
    onFileSelect,
    onCreateFolder,
    onCreateTextFile,
  };
}
