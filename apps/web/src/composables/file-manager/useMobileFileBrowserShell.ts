import { provide } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import { FILE_MANAGER_INJECTION_KEY } from './useFileManager';
import { useFileBrowserShared } from './useFileBrowserShared';
import { useMobileFileBrowserSelection } from './useMobileFileBrowserSelection';
import { useMobileFileBrowserCreate } from './useMobileFileBrowserCreate';
import { useMobileFileBrowserModals } from './useMobileFileBrowserModals';
import { usePullToRefresh } from './usePullToRefresh';
import { useFileManagerStore } from '~/stores/file-manager.store';
import type { FsEntry } from '~/types/fs';
import type { FileCompatibility } from './useFileManagerCompatibility';

export type MobileFileBrowserStore =
  | ReturnType<typeof useFileManagerStore>
  | ReturnType<typeof import('~/stores/file-manager.store').useMobileAssetBrowserStore>;

export interface UseMobileFileBrowserShellOptions {
  /** File manager instance created by useFileManager. */
  fileManager: ReturnType<(typeof import('./useFileManager'))['useFileManager']>;
  /** Store to provide for selection/create. Defaults to useFileManagerStore. */
  fileManagerStore?: MobileFileBrowserStore;
  instanceId?: string;
  isExternal?: boolean;
  /** Entries used by shared actions and modals. */
  entries: Ref<FsEntry[]> | ComputedRef<FsEntry[]>;
  /** Compatibility map for the current entries. */
  compatibility:
    Ref<Record<string, FileCompatibility>> | ComputedRef<Record<string, FileCompatibility>>;
  /** Reloads the current view after destructive changes. */
  reload: () => Promise<void>;
  /** Optional loadFolderContent for the create composable. Defaults to reload. */
  loadFolderContent?: () => Promise<void>;
  /** Optional custom rename validation. */
  validateRename?: (newName: string) => string | boolean | null;
}

export function useMobileFileBrowserShell(options: UseMobileFileBrowserShellOptions) {
  const fileManager = options.fileManager;
  provide(FILE_MANAGER_INJECTION_KEY, fileManager);

  const fileManagerStore = options.fileManagerStore ?? useFileManagerStore();
  provide('fileManagerStore', fileManagerStore);

  const {
    findEntryByPath,
    mediaCache,
    vfs,
    handleFiles,
    createFolder,
    createMarkdown,
    reloadDirectory,
    deleteEntry,
    renameEntry,
    copyEntry,
    moveEntry,
    readDirectory,
  } = fileManager;

  const loadFolderContent = options.loadFolderContent ?? options.reload;

  const {
    isSelectionMode,
    isDrawerOpen,
    selectedEntries,
    totalSelectedSize,
    toggleSelectionMode,
    handleLongPress,
    handleToggleSelection,
    handleEntryClick,
    closeAllUI,
  } = useMobileFileBrowserSelection();

  const {
    fileInput,
    triggerFileUpload,
    triggerGlobalFileUpload,
    onFileSelect,
    onCreateFolder: runCreateFolder,
    onCreateTextFile: runCreateTextFile,
    isCreateMenuOpen,
  } = useMobileFileBrowserCreate({
    createFolder,
    createMarkdown,
    handleFiles: (files: File[], targetPath?: string) =>
      handleFiles(files, targetPath !== undefined ? { targetDirPath: targetPath } : {}),
    loadFolderContent,
  });

  const { isPulling, pullDistance, isRefreshing, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(options.reload);

  const {
    onFileAction,
    isDeleteConfirmModalOpen,
    deleteTargets,
    handleDeleteConfirm,
    modalOpen: transcriptionModalOpen,
    language: transcriptionLanguage,
    errorMessage: transcriptionError,
    isTranscribing,
    isModelReady,
    pendingEntry: transcriptionEntry,
    openModal: openTranscriptionModal,
    submitTranscription,
  } = useFileBrowserShared({
    vfs,
    folderEntries: options.entries,
    loadFolderContent,
    createFolder,
    renameEntry,
    deleteEntry,
    loadProjectDirectory: options.reload,
    handleFiles,
    mediaCache,
    findEntryByPath,
    readDirectory,
    reloadDirectory,
    copyEntry,
    moveEntry,
    isExternal: options.isExternal ?? false,
    instanceId: options.instanceId,
    onAfterRename: options.reload,
    onAfterDelete: options.reload,
  });

  const {
    canAddSelectionToTimeline,
    handleAddToProject,
    handleAddSelectionToTimeline,
    isRenameModalOpen,
    entryToRename,
    validateRename,
    onRenameConfirm,
    handleDrawerAction,
    wrappedHandleDeleteConfirm,
  } = useMobileFileBrowserModals({
    entries: options.entries,
    compatibility: options.compatibility,
    isSelectionMode,
    selectedEntries,
    isDrawerOpen,
    closeAllUI,
    renameEntry,
    reload: options.reload,
    onFileAction,
    handleDeleteConfirm,
    openTranscriptionModal,
    validateRename: options.validateRename,
  });

  return {
    fileManager,
    fileManagerStore,
    findEntryByPath,
    mediaCache,
    vfs,
    handleFiles,
    createFolder,
    createMarkdown,
    reloadDirectory,
    deleteEntry,
    renameEntry,
    copyEntry,
    moveEntry,
    readDirectory,
    fileInput,
    triggerFileUpload,
    triggerGlobalFileUpload,
    onFileSelect,
    runCreateFolder,
    runCreateTextFile,
    isCreateMenuOpen,
    isSelectionMode,
    isDrawerOpen,
    selectedEntries,
    totalSelectedSize,
    toggleSelectionMode,
    handleLongPress,
    handleToggleSelection,
    handleEntryClick,
    closeAllUI,
    isPulling,
    pullDistance,
    isRefreshing,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onFileAction,
    isDeleteConfirmModalOpen,
    deleteTargets,
    handleDeleteConfirm,
    transcriptionModalOpen,
    transcriptionLanguage,
    transcriptionError,
    isTranscribing,
    isModelReady,
    transcriptionEntry,
    openTranscriptionModal,
    submitTranscription,
    canAddSelectionToTimeline,
    handleAddToProject,
    handleAddSelectionToTimeline,
    isRenameModalOpen,
    entryToRename,
    validateRename,
    onRenameConfirm,
    handleDrawerAction,
    wrappedHandleDeleteConfirm,
  };
}
