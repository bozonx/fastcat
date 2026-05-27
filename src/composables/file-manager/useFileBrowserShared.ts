import type { Ref } from 'vue';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileManagerActions } from '~/composables/file-manager/useFileManagerActions';
import { useFileBrowserFileActions } from '~/composables/file-manager/useFileBrowserFileActions';
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';

export interface UseFileBrowserSharedDeps {
  vfs: IFileSystemAdapter;
  folderEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  renameEntry: (target: FsEntry, newName: string) => Promise<void>;
  deleteEntry: (target: FsEntry) => Promise<void>;
  loadProjectDirectory: (params?: { fullRefresh?: boolean }) => Promise<void>;
  handleFiles: (
    files: File[] | FileList,
    options?: {
      targetDirPath?: string;
      abortSignal?: AbortSignal;
      onProgress?: (params: {
        currentFileIndex: number;
        totalFiles: number;
        fileName: string;
      }) => void;
    },
  ) => Promise<unknown>;
  findEntryByPath: (path: string) => FsEntry | null;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  reloadDirectory: (path: string) => Promise<void>;
  mediaCache: Pick<ProxyThumbnailService, 'ensureProxy' | 'cancelProxy' | 'removeProxy'>;
  copyEntry?: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  moveEntry?: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  instanceId?: string;
  isExternal?: boolean;
  notifyFileManagerUpdate?: () => void;
  setFileTreePathExpanded?: (path: string, expanded: boolean) => void;
  onFileSelect?: (entry: FsEntry) => void;
  onAfterRename?: () => void;
  onAfterDelete?: () => void;
}

export function useFileBrowserShared(deps: UseFileBrowserSharedDeps) {
  const conversionStore = useFileConversionStore();
  const { extractAudio } = useAudioExtraction();

  const fileManagerActions = useFileManagerActions(deps);

  const stt = useSttTranscription({ vfs: deps.vfs });

  const { onFileAction } = useFileBrowserFileActions({
    folderEntries: deps.folderEntries,
    loadFolderContent: deps.loadFolderContent,
    onFileActionBase: fileManagerActions.onFileAction,
    conversionStore,
    openTranscriptionModal: stt.openModal,
    extractAudio: (entry: FsEntry) =>
      extractAudio(entry, {
        instanceId: deps.instanceId,
        isExternal: deps.isExternal,
      }),
    vfs: deps.vfs,
    isExternal: deps.isExternal,
  });

  return {
    ...fileManagerActions,
    onFileActionBase: fileManagerActions.onFileAction,
    ...stt,
    onFileAction,
  };
}
