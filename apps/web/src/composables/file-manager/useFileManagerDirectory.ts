import { watch } from 'vue';
import {
  getWorkspacePathFileName,
  getWorkspacePathParent,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';
import type { FsEntry } from '~/types/fs';
import type { FileManagerContext } from './fileManagerContext';

export function createFileManagerDirectory(ctx: FileManagerContext) {
  const { deps, service, runWithUiFeedback, notifyFileManagerUpdate } = ctx;

  watch(
    () => deps.showHiddenFiles.value,
    async () => {
      await loadProjectDirectory({ fullRefresh: true });
      notifyFileManagerUpdate();
    },
  );

  function findEntryByPath(path: string): FsEntry | null {
    return service.findEntryByPath(path);
  }

  async function resolveEntryByPath(path: string): Promise<FsEntry | null> {
    const existingEntry = findEntryByPath(path);
    if (existingEntry) return existingEntry;

    const normalizedPath = path.trim();
    if (!normalizedPath) return null;

    if (normalizedPath === WORKSPACE_COMMON_PATH_PREFIX) {
      return {
        name: deps.t('videoEditor.fileManager.commonFolder'),
        kind: 'directory',
        path: WORKSPACE_COMMON_PATH_PREFIX,
      };
    }

    const metadata = await deps.vfs.getMetadata(normalizedPath);
    if (!metadata) return null;

    return {
      name: getWorkspacePathFileName(normalizedPath) || normalizedPath,
      kind: metadata.kind,
      path: normalizedPath,
      parentPath: getWorkspacePathParent(normalizedPath) || undefined,
      lastModified: metadata.lastModified,
      size: metadata.size,
    };
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    return service.mergeEntries(prev, next);
  }

  let suppressDirectoryLoadedNotification = false;

  async function withWorkspaceCommonRoot(entries: FsEntry[]): Promise<FsEntry[]> {
    const commonMetadata = await deps.vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
    if (!commonMetadata || commonMetadata.kind !== 'directory') return entries;

    const previousCommonEntry = entries.find(
      (entry) => entry.path === WORKSPACE_COMMON_PATH_PREFIX,
    );
    let commonChildren: FsEntry[];
    try {
      commonChildren = await service.readDirectory(WORKSPACE_COMMON_PATH_PREFIX, {
        checkChildren: true,
      });
    } catch {
      commonChildren = previousCommonEntry?.children ?? [];
    }
    const commonEntry: FsEntry = {
      name: deps.t('videoEditor.fileManager.commonFolder'),
      kind: 'directory',
      path: WORKSPACE_COMMON_PATH_PREFIX,
      parentPath: undefined,
      lastModified: commonMetadata.lastModified,
      size: commonMetadata.size,
      expanded: deps.isFileTreePathExpanded(WORKSPACE_COMMON_PATH_PREFIX),
      children: deps.isFileTreePathExpanded(WORKSPACE_COMMON_PATH_PREFIX)
        ? mergeEntries(previousCommonEntry?.children, commonChildren)
        : undefined,
      hasChildren: commonChildren.length > 0,
      hasDirectories: commonChildren.some((entry) => entry.kind === 'directory'),
    };

    const withoutCommon = entries.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX);
    return [commonEntry, ...withoutCommon];
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    await runWithUiFeedback({
      action: async () => {
        await service.toggleDirectory(entry);
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.readFolder'),
      toastTitle: deps.t('videoEditor.fileManager.errors.folderError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.readFolder'),
      ignoreError: () => false,
    });
  }

  async function ensureDirectoryExpanded(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    await runWithUiFeedback({
      action: async () => {
        await service.ensureDirectoryExpanded(entry);
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.readFolder'),
      toastTitle: deps.t('videoEditor.fileManager.errors.folderError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.readFolder'),
      ignoreError: () => false,
    });
  }

  async function loadProjectDirectory(options?: {
    fullRefresh?: boolean;
    suppressNotification?: boolean;
  }) {
    const projectName = deps.getProjectName();
    if (!projectName) {
      deps.rootEntries.value = [];
      void deps.timelineMediaUsageStore?.refreshUsage();
      return;
    }

    const shouldFullRefresh = options?.fullRefresh ?? false;

    const previousSuppressNotification = suppressDirectoryLoadedNotification;
    suppressDirectoryLoadedNotification =
      previousSuppressNotification || Boolean(options?.suppressNotification);

    try {
      await runWithUiFeedback({
        action: async () => {
          await service.loadProjectDirectory('', {
            refreshExpandedChildren: shouldFullRefresh,
            expandPersistedDirectories: true,
            autoExpandMediaDirs: true,
          });
          if (!deps.hideCommonRoot) {
            deps.rootEntries.value = await withWorkspaceCommonRoot(deps.rootEntries.value);
          }
        },

        defaultErrorMessage: deps.t('videoEditor.fileManager.errors.openProjectFolder'),
        toastTitle: deps.t('videoEditor.fileManager.errors.projectError'),
        toastDescription: () => deps.t('videoEditor.fileManager.errors.openProjectFolder'),
      });
    } finally {
      suppressDirectoryLoadedNotification = previousSuppressNotification;
    }
  }

  async function reloadDirectory(path: string) {
    await service.reloadDirectory(path);
    if (!path && !deps.hideCommonRoot) {
      deps.rootEntries.value = await withWorkspaceCommonRoot([...deps.rootEntries.value]);
    }
  }

  ctx.reloadDirectory = reloadDirectory;
  ctx.loadProjectDirectory = loadProjectDirectory;

  return {
    findEntryByPath,
    resolveEntryByPath,
    mergeEntries,
    toggleDirectory,
    ensureDirectoryExpanded,
    loadProjectDirectory,
    reloadDirectory,
  };
}
