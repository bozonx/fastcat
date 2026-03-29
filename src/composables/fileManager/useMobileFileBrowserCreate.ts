import { ref } from 'vue';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useProjectStore } from '~/stores/project.store';

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
  const filesPageStore = useFilesPageStore();
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
      const targetPath = pendingUploadPath.value ?? filesPageStore.selectedFolder?.path ?? '';
      handleFiles(files, targetPath).then(() => {
        loadFolderContent();
        isCreateMenuOpen.value = false;
      });
    }
  }

  async function onCreateFolder(name: string) {
    if (name) {
      const parentPath = filesPageStore.selectedFolder?.path || '';
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
      await loadFolderContent();
      isCreateMenuOpen.value = false;
      toast.add({
        title: t('common.success', 'Success'),
        description: t('common.saveSuccess', 'Saved successfully'),
        color: 'success',
      });
    }
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
