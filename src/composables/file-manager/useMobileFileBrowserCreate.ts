import { ref, inject } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { DOCUMENTS_DIR_NAME } from '~/utils/constants';

interface CreateDeps {
  createFolder: (name: string, parentPath: string) => Promise<void>;
  createTimeline: (targetPath?: string) => Promise<string | null>;
  createMarkdown: (targetPath?: string) => Promise<string | null>;
  handleFiles: (files: File[], targetPath: string) => Promise<void>;
  loadFolderContent: () => Promise<void>;
}

export function useMobileFileBrowserCreate({
  createFolder,
  createTimeline,
  createMarkdown,
  handleFiles,
  loadFolderContent,
}: CreateDeps) {
  const fileManagerStore = inject('fileManagerStore') as ReturnType<typeof useFileManagerStore> || useFileManagerStore();
  const projectStore = useProjectStore();
  const { t } = useI18n();
  const toast = useToast();

  const fileInput = ref<HTMLInputElement | null>(null);
  const pendingUploadPath = ref<string | undefined>(undefined);
  const isCreateMenuOpen = ref(false);

  async function triggerFileUpload(targetPath?: string) {
    pendingUploadPath.value = targetPath;
    fileInput.value?.click();
  }

  function onFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      const files = Array.from(target.files);
      target.value = '';
      const targetPath = pendingUploadPath.value ?? fileManagerStore.selectedFolder?.path ?? '';
      handleFiles(files, targetPath).then(() => {
        loadFolderContent();
        isCreateMenuOpen.value = false;
      });
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

  async function onCreateTimeline(targetPath?: string) {
    const path = await createTimeline(targetPath);
    if (path) {
      await loadFolderContent();
      isCreateMenuOpen.value = false;

      await projectStore.openTimelineFile(path);
      projectStore.setView('cut');

      toast.add({
        title: t('common.success', 'Success'),
        description: t('timelineCreation.successTitle', 'Timeline created'),
        color: 'success',
      });
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
    isCreateMenuOpen,
    triggerFileUpload,
    onFileSelect,
    onCreateFolder,
    onCreateTimeline,
    onCreateTextFile,
  };
}
