import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import {
  handleFilesCommand,
  resolveDefaultTargetDir,
  LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES,
  type UploadResult,
  type HandleFilesDeps,
} from '~/file-manager/application/fileManagerCommands';
import type { FileManagerContext } from './fileManagerContext';

export function createFileManagerUpload(ctx: FileManagerContext) {
  const {
    deps,
    runWithUiFeedback,
    notifyFileManagerUpdate,
    loadProjectDirectory,
    reloadDirectory,
    resolveEntryByPath,
  } = ctx;

  async function handleFiles(
    files: FileList | File[],
    options?: {
      targetDirPath?: string;
      abortSignal?: AbortSignal;
      onProgress?: HandleFilesDeps['onProgress'];
      backgroundMode?: 'auto' | 'never';
      selectInFileManager?: boolean;
    },
  ) {
    const projectName = deps.getProjectName();
    if (!projectName) return;

    const {
      targetDirPath,
      abortSignal,
      onProgress,
      backgroundMode = 'auto',
      selectInFileManager = true,
    } = options ?? {};
    const inputFiles = Array.from(files);
    const totalBytes = inputFiles.reduce((acc, file) => acc + file.size, 0);
    const shouldUseBackgroundTask =
      backgroundMode === 'auto' && totalBytes >= LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES;
    const backgroundTasksStore = shouldUseBackgroundTask ? useBackgroundTasksStore() : null;
    const taskAbortController = shouldUseBackgroundTask ? new AbortController() : null;
    const signal = shouldUseBackgroundTask ? taskAbortController?.signal : abortSignal;
    const backgroundTaskId = backgroundTasksStore?.addTask({
      title:
        inputFiles.length === 1
          ? deps.t('videoEditor.fileManager.actions.importingFile', {
              fileName: inputFiles[0]?.name ?? '',
            })
          : deps.t('fastcat.timeline.importFilesCount', { count: inputFiles.length }),
      type: 'file-operation',
      status: 'running',
      progress: 0,
      cancel: () => taskAbortController?.abort(),
    });

    const uploadResults = await runWithUiFeedback({
      action: async () => {
        const results = await handleFilesCommand(
          inputFiles,
          {
            targetDirPath,
            abortSignal: signal,
          },
          {
            vfs: deps.vfs,
            getTargetDirPath: async ({ file }) => await resolveDefaultTargetDir({ file }),
            onSkipProjectFile: ({ file }) => {
              deps.toast.add({
                color: 'neutral',
                title: deps.t('videoEditor.fileManager.skipOtio.title'),
                description: deps.t('videoEditor.fileManager.skipOtio.description', {
                  fileName: file.name,
                }),
              });
            },
            onMediaImported: ({ projectRelativePath }) => {
              deps.onMediaImported({ projectRelativePath });
            },
            onProgress: (progress) => {
              onProgress?.(progress);
              if (backgroundTasksStore && backgroundTaskId) {
                const total = progress.totalBytes ?? totalBytes;
                const loaded = progress.loadedBytes ?? 0;
                backgroundTasksStore.updateTaskProgress(
                  backgroundTaskId,
                  total > 0 ? loaded / total : 0,
                );
              }
            },
          },
        );

        if (targetDirPath !== undefined) {
          await reloadDirectory(targetDirPath);
        } else {
          await loadProjectDirectory({ fullRefresh: true });
        }
        return results;
      },
      defaultErrorMessage: 'Failed to upload files',
      toastTitle: 'Upload error',
      toastDescription: () => 'Failed to upload files',
      ignoreError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
    });

    if (backgroundTasksStore && backgroundTaskId) {
      const wasAborted = signal?.aborted === true;
      if (wasAborted) {
        backgroundTasksStore.updateTaskStatus(backgroundTaskId, 'cancelled');
      } else if (uploadResults) {
        backgroundTasksStore.updateTaskProgress(backgroundTaskId, 1);
        backgroundTasksStore.updateTaskStatus(backgroundTaskId, 'completed');
      } else {
        backgroundTasksStore.updateTaskStatus(backgroundTaskId, 'failed', 'Upload failed');
      }
    }

    if (uploadResults && uploadResults.length > 0) {
      const grouped = new Map<string, { count: number; type: string; folder: string }>();
      uploadResults.forEach((r: UploadResult) => {
        const type = getMediaTypeFromFilename(r.fileName) || 'file';
        const key = `${r.targetDir}:${type}`;
        const existing = grouped.get(key) || { count: 0, type, folder: r.targetDir };
        grouped.set(key, { ...existing, count: existing.count + 1 });
      });

      const summaries: string[] = [];
      grouped.forEach((val) => {
        const typeLabel = deps.t(`videoEditor.fileManager.upload.types.${val.type}`, val.type);
        summaries.push(
          deps.t('videoEditor.fileManager.upload.summary', {
            count: val.count,
            type: typeLabel,
            folder: val.folder || '/',
          }),
        );
      });

      deps.toast.add({
        color: 'success',
        title: !targetDirPath
          ? deps.t('videoEditor.fileManager.upload.autoUploadTitle')
          : deps.t('videoEditor.fileManager.upload.successTitle'),
        description: summaries.join(', '),
      });

      if (selectInFileManager) {
        const lastResult = uploadResults[uploadResults.length - 1];
        if (lastResult) {
          const fileManagerStore = useFileManagerStore();
          fileManagerStore.openFolderByPath(lastResult.targetDir);

          const newEntry = await resolveEntryByPath(lastResult.targetPath);
          if (newEntry) {
            const selectionStore = useSelectionStore();
            selectionStore.selectFsEntryWithUiUpdate(newEntry);
          }
        }
      }
    }

    if (uploadResults && uploadResults.length > 0) {
      notifyFileManagerUpdate();
    }

    return uploadResults;
  }

  return { handleFiles };
}
