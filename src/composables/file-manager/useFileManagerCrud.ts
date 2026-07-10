import {
  createFolderCommand,
  deleteEntryCommand,
  renameEntryCommand,
  moveEntryCommand,
  copyEntryCommand,
} from '~/file-manager/application/fileManagerCommands';
import { VIDEO_DIR_NAME, AUDIO_DIR_NAME } from '~/utils/constants';
import {
  isMoveAllowed as isMoveAllowedCore,
  isCopyAllowed as isCopyAllowedCore,
} from '~/file-manager/core/rules';
import {
  getBloggerDogTextWrapperRenameResult,
  isBloggerDogTextWrapper,
} from '~/utils/bloggerdog-file-manager';
import { removeProxyCommand } from '~/media-cache/application/proxyThumbnailCommands';
import type { FsEntry } from '~/types/fs';
import type { FileManagerContext } from './fileManagerContext';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return isMoveAllowedCore(params);
}

export function isCopyAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return isCopyAllowedCore(params);
}

export function createFileManagerCrud(ctx: FileManagerContext) {
  const {
    deps,
    runWithUiFeedback,
    notifyFileManagerUpdate,
    reloadDirectory,
    triggerMediaIntegrityCheck,
    getParentPath,
  } = ctx;

  async function createFolder(name: string, parentPath: string = '') {
    const projectName = deps.getProjectName();
    if (!projectName) return;

    const created = await runWithUiFeedback({
      action: async () => {
        if (parentPath) {
          deps.setFileTreePathExpanded(parentPath, true);
        }

        await createFolderCommand({ name, parentPath, vfs: deps.vfs });
        const createdPath = parentPath ? `${parentPath}/${name}` : name;

        if (deps.shouldRecordFileManagerHistory() && !ctx.isRestoringHistory) {
          deps.historyStore.push(
            'fileManager',
            'createFolder',
            {
              undo: { type: 'delete', path: createdPath },
              redo: { type: 'createFolder', parentPath, name },
            },
            'videoEditor.fileManager.history.entries.createFolder',
          );
        }

        await reloadDirectory(parentPath);
        return true;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.createFolder'),
      toastTitle: deps.t('videoEditor.fileManager.errors.folderError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.createFolder'),
    });
    if (created) {
      notifyFileManagerUpdate();
    }
  }

  async function reloadDirectories(paths: Iterable<string>) {
    const uniquePaths = [...new Set(Array.from(paths))];
    await Promise.all(uniquePaths.map((path) => reloadDirectory(path)));
  }

  interface CrudMutationOptions {
    skipReload?: boolean;
    skipNotify?: boolean;
    skipIntegrityCheck?: boolean;
  }

  async function deleteEntry(target: FsEntry, options: CrudMutationOptions = {}) {
    const deleted = await runWithUiFeedback({
      action: async () => {
        const deletedFilePaths = await deleteEntryCommand(target, {
          vfs: deps.vfs,
          onFileDeleted: async ({ path }) => {
            await ctx.clearVectorCacheForPath(path);
            await deps.onFileDeleted?.({ path });
          },
        });

        const videoPaths: string[] = [];
        const mediaPaths: string[] = [];

        for (const path of deletedFilePaths) {
          if (path.startsWith(`${VIDEO_DIR_NAME}/`)) {
            videoPaths.push(path);
            mediaPaths.push(path);
          } else if (path.startsWith(`${AUDIO_DIR_NAME}/`)) {
            mediaPaths.push(path);
          }
        }

        const projectId = deps.getProjectId();

        if (videoPaths.length > 0) {
          await deps.mediaCache.removeProxyBatch({
            projectRelativePaths: videoPaths,
          });

          if (projectId) {
            await Promise.all(
              videoPaths.map((path) =>
                deps.mediaCache.clearVideoThumbnails({
                  projectId,
                  projectRelativePath: path,
                }),
              ),
            );
          }
        }

        if (mediaPaths.length > 0 && projectId) {
          await Promise.all(
            mediaPaths.map((path) =>
              deps.mediaCache.clearWaveforms({
                projectId,
                projectRelativePath: path,
              }),
            ),
          );
        }

        const parentPath = getParentPath(target.path);
        if (!options.skipReload) {
          await reloadDirectory(parentPath);
        }
        if (!options.skipIntegrityCheck) {
          await triggerMediaIntegrityCheck();
        }
        return true;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.deleteEntry'),
      toastTitle: deps.t('videoEditor.fileManager.errors.deleteError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.deleteEntry'),
    });
    if (deleted && !options.skipNotify) {
      notifyFileManagerUpdate();
    }
  }

  async function renameEntry(target: FsEntry, newName: string) {
    const oldPath = target.path;
    const parentPath = getParentPath(oldPath);
    const textWrapperRenameResult = isBloggerDogTextWrapper(target)
      ? getBloggerDogTextWrapperRenameResult(target, newName)
      : null;
    const newPath =
      textWrapperRenameResult?.newPath ??
      (oldPath ? (parentPath ? `${parentPath}/${newName}` : newName) : '');

    const renamed = await runWithUiFeedback({
      action: async () => {
        await renameEntryCommand({ target, newName }, { vfs: deps.vfs });

        if (oldPath && newPath) {
          if (deps.shouldRecordFileManagerHistory() && !ctx.isRestoringHistory) {
            deps.historyStore.push(
              'fileManager',
              'rename',
              {
                undo: { type: 'rename', from: newPath, to: target.name },
                redo: { type: 'rename', from: oldPath, to: newName },
              },
              'videoEditor.fileManager.history.entries.renameEntry',
            );
          }
          await deps.onEntryPathChanged?.({ oldPath, newPath });
        }

        const parentPathForRename =
          textWrapperRenameResult?.reloadDirPath ?? getParentPath(target.path);
        await reloadDirectory(parentPathForRename);
        await triggerMediaIntegrityCheck();
        return true;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.renameEntry'),
      toastTitle: deps.t('videoEditor.fileManager.errors.renameError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.renameEntry'),
    });
    if (renamed) {
      notifyFileManagerUpdate();
    }
  }

  async function moveEntry(
    params: { source: FsEntry; targetDirPath: string },
    options: CrudMutationOptions = {},
  ) {
    const projectName = deps.getProjectName();
    if (!projectName) return;

    const sourcePath = params.source.path;
    const targetDirPath = params.targetDirPath ?? '';
    if (!sourcePath) return;

    const sourceParentPath = getParentPath(sourcePath);
    if (sourceParentPath === targetDirPath) return;

    if (!isMoveAllowed({ sourcePath, targetDirPath })) return;

    const newPath = await runWithUiFeedback({
      action: async () => {
        const { newPath } = await moveEntryCommand(
          { source: params.source, targetDirPath },
          {
            vfs: deps.vfs,
            onFileMoved: async ({ oldPath, newPath }) => {
              if (deps.shouldRecordFileManagerHistory() && !ctx.isRestoringHistory) {
                deps.historyStore.push(
                  'fileManager',
                  'move',
                  {
                    undo: { type: 'move', from: newPath, to: sourceParentPath },
                    redo: { type: 'move', from: oldPath, to: targetDirPath },
                  },
                  'videoEditor.fileManager.history.entries.moveEntry',
                );
              }
              await deps.onEntryPathChanged?.({ oldPath, newPath });

              // When there is no project context, proxies cannot be tracked by project ID,
              // so remove the old proxy and re-check the new path from scratch.
              if (oldPath.startsWith(`${VIDEO_DIR_NAME}/`)) {
                const projectId = deps.getProjectId();
                if (!projectId) {
                  await removeProxyCommand({
                    service: deps.mediaCache,
                    projectRelativePath: oldPath,
                  });
                  deps.mediaCache.clearExistingProxies();
                  await deps.mediaCache.checkExistingProxies([newPath]);
                }
              }
            },
            onDirectoryMoved: async ({ oldPath, newPath }) => {
              await deps.onDirectoryMoved?.({ oldPath, newPath });
              if (!oldPath || !newPath) {
                deps.mediaCache.clearExistingProxies();
              }
            },
          },
        );

        if (targetDirPath) {
          deps.setFileTreePathExpanded(targetDirPath, true);
        }

        if (!options.skipReload) {
          await reloadDirectories([sourceParentPath, targetDirPath]);
        }
        if (!options.skipIntegrityCheck) {
          await triggerMediaIntegrityCheck();
        }

        return newPath;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.moveEntry'),
      toastTitle: deps.t('videoEditor.fileManager.errors.moveError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.moveEntry'),
    });
    if (newPath && !options.skipNotify) {
      notifyFileManagerUpdate();
    }
    return newPath;
  }

  async function copyEntry(
    params: {
      source: FsEntry;
      targetDirPath: string;
      abortSignal?: AbortSignal;
    },
    options: CrudMutationOptions = {},
  ) {
    const projectName = deps.getProjectName();
    if (!projectName) return null;

    const sourcePath = params.source.path;
    const targetDirPath = params.targetDirPath ?? '';
    if (!sourcePath) return null;

    if (!isCopyAllowed({ sourcePath, targetDirPath })) return null;

    const newPath = await runWithUiFeedback({
      action: async () => {
        const { newPath } = await copyEntryCommand(
          { source: params.source, targetDirPath, abortSignal: params.abortSignal },
          {
            vfs: deps.vfs,
            onFileCopied: async ({ newPath }) => {
              await deps.mediaStore.removeMediaCache(newPath);
            },
            onDirectoryCopied: async ({ oldPath, newPath }) => {
              await deps.onDirectoryCopied?.({ oldPath, newPath });
            },
          },
        );

        if (targetDirPath) {
          deps.setFileTreePathExpanded(targetDirPath, true);
        }

        const sourceParentPath = getParentPath(sourcePath);
        if (!options.skipReload) {
          await reloadDirectories(
            sourceParentPath && sourceParentPath !== targetDirPath
              ? [targetDirPath, sourceParentPath]
              : [targetDirPath],
          );
        }
        if (!options.skipIntegrityCheck) {
          await triggerMediaIntegrityCheck();
        }

        return newPath;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.copyEntry'),
      toastTitle: deps.t('videoEditor.fileManager.errors.copyError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.copyEntry'),
      ignoreError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
    });
    if (newPath && !options.skipNotify) {
      notifyFileManagerUpdate();
    }
    return newPath;
  }

  return { createFolder, deleteEntry, renameEntry, moveEntry, copyEntry };
}
