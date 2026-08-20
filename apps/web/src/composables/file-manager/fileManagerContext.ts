import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { FastCatProjectSettings } from '~/utils/project-settings';
import type { createFileManagerService } from '~/file-manager/application/fileManagerService';
import type { createUiActionRunner, ToastOptions } from './useUiActionRunner';

export type FileTreeSortMode = 'name' | 'type';

export interface FileManagerCreateDeps {
  t: (key: string, params?: Record<string, unknown> | string) => string;
  toast: { add: (options: ToastOptions) => void };
  vfs: IFileSystemAdapter;
  isApiSupported: Ref<boolean>;
  rootEntries: Ref<FsEntry[]>;
  sortMode: Ref<FileTreeSortMode>;
  showHiddenFiles: Ref<boolean>;
  isFileTreePathExpanded: (path: string) => boolean;
  setFileTreePathExpanded: (path: string, expanded: boolean) => void;
  getExpandedPaths: () => string[];
  hasPersistedFileTreeState?: () => boolean;
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getProjectName: () => string | null;
  getProjectId: () => string | null;
  getProjectSize: () => { width: number; height: number };
  getProjectSettings?: () => FastCatProjectSettings;
  onMediaImported: (params: { projectRelativePath: string }) => void;
  onFileDeleted?: (params: { path: string }) => void | Promise<void>;
  mediaCache: import('~/media-cache/application/proxyThumbnailService').ProxyThumbnailService;
  mediaStore: {
    removeMediaCache: (path: string) => Promise<void>;
    revalidateMissingMedia: (paths: string[]) => Promise<void>;
  };
  historyStore: {
    push: (scope: string, command: string, snapshot: unknown, label: string) => void;
    registerCommandScope: (scope: string) => void;
  };
  onEntryPathChanged?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
  onDirectoryMoved?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
  onDirectoryCopied?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
  onDirectoryLoaded?: () => void;
  notifyFileManagerUpdate?: () => void;
  timelineMediaUsageStore?: {
    refreshUsage: () => Promise<void>;
    mediaPathToTimelines: Record<string, unknown>;
  };
  shouldRecordFileManagerHistory: () => boolean;
  hideCommonRoot?: boolean;
}

export interface FileManagerContext {
  deps: FileManagerCreateDeps;
  service: ReturnType<typeof createFileManagerService>;
  runWithUiFeedback: ReturnType<typeof createUiActionRunner>;
  notifyFileManagerUpdate: () => void;
  isRestoringHistory: boolean;
  reloadDirectory: (path: string) => Promise<void>;
  loadProjectDirectory: (options?: {
    fullRefresh?: boolean;
    suppressNotification?: boolean;
  }) => Promise<void>;
  triggerMediaIntegrityCheck: () => Promise<void>;
  clearVectorCacheForPath: (path: string) => Promise<void>;
  clearVectorCacheForDirectory: (oldPath: string, newPath: string) => Promise<void>;
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  getParentPath: (path?: string) => string;
}
