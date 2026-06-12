import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useUiStore } from '~/stores/ui.store';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeExtractAudio,
  nativeMediaMetadata,
} from '~/utils/tauri-media-processing';
import { randomToken } from '~/utils/ids';

export function useBatchAudioExtraction() {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const { t } = useI18n();
  const toast = useToast();
  const isExtracting = ref(false);

  async function getWorkspaceFileHandle(
    path: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandle | null> {
    const wsHandle = workspaceStore.workspaceHandle;
    if (!wsHandle) return null;

    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return null;

    try {
      let currentDir: FileSystemDirectoryHandle = wsHandle;
      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part, {
          create: options?.create ?? false,
        });
      }
      return await currentDir.getFileHandle(fileName, {
        create: options?.create ?? false,
      });
    } catch {
      return null;
    }
  }

  async function extractSingleAudio(
    entry: FsEntry,
    isExternal: boolean,
    taskIdPrefix: string,
  ): Promise<'no-audio' | void> {
    if (!entry.path) return;

    const useNativeExtraction = isTauriRuntime();
    let sourceNativePath: string | null = null;
    let meta: { audio?: { codec?: string | null } | null };

    if (useNativeExtraction) {
      const sourceHandle = isExternal
        ? await getWorkspaceFileHandle(entry.path)
        : await projectStore.getFileHandleByPath(entry.path);
      sourceNativePath = getNativeFileHandlePath(sourceHandle);
      if (!sourceNativePath) throw new Error('Failed to resolve native source path');
      meta = await nativeMediaMetadata(sourceNativePath);
    } else {
      let sourceFile: File | null = null;
      if (isExternal) {
        const handle = await getWorkspaceFileHandle(entry.path);
        if (handle) {
          try {
            sourceFile = await withFileIoSlot(() => handle.getFile());
          } catch {
            /* fall through */
          }
        }
      }
      if (!sourceFile) {
        sourceFile = await projectStore.getFileByPath(entry.path);
      }
      if (!sourceFile) throw new Error('Failed to access source file');

      const { client } = getExportWorkerClient();
      setExportHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => projectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path) =>
            isExternal
              ? ((await getWorkspaceFileHandle(path)) ?? projectStore.getFileHandleByPath(path))
              : projectStore.getFileHandleByPath(path),
          getFileByPath: async (path) => {
            if (isExternal) {
              const handle = await getWorkspaceFileHandle(path);
              if (handle) {
                try {
                  return await withFileIoSlot(() => handle.getFile());
                } catch {
                  /* fall through */
                }
              }
            }
            return projectStore.getFileByPath(path);
          },
          onExportProgress: () => {},
        }),
      );

      meta = await client.extractMetadata(sourceFile);
    }

    if (!meta.audio) {
      return 'no-audio';
    }

    const codec = meta.audio.codec || '';
    const lowercaseCodec = codec.toLowerCase();

    let ext = 'mka';
    if (lowercaseCodec.startsWith('mp4a') || lowercaseCodec.includes('aac')) {
      ext = 'm4a';
    } else if (lowercaseCodec.includes('opus')) {
      ext = useNativeExtraction ? 'opus' : 'weba';
    } else if (lowercaseCodec.includes('mp3')) {
      ext = useNativeExtraction ? 'mp3' : 'mka';
    }

    const dirPath = entry.path.split('/').slice(0, -1).join('/');
    const baseName = entry.name.replace(/\.[^.]+$/, '');

    let newFileName = `${baseName}_extracted.${ext}`;
    let counter = 2;
    while (await fileManager.vfs.exists(dirPath ? `${dirPath}/${newFileName}` : newFileName)) {
      newFileName = `${baseName}_extracted (${counter}).${ext}`;
      counter++;
    }

    const targetPath = dirPath ? `${dirPath}/${newFileName}` : newFileName;

    let targetHandle: FileSystemFileHandle | null = null;
    if (isExternal) {
      targetHandle = await getWorkspaceFileHandle(targetPath, { create: true });
    } else {
      const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
      if (dirHandle) {
        targetHandle = await dirHandle.getFileHandle(newFileName, { create: true });
      }
    }

    if (useNativeExtraction) {
      const targetNativePath = getNativeFileHandlePath(targetHandle);
      if (!sourceNativePath || !targetNativePath) {
        throw new Error('Failed to resolve native audio extraction paths');
      }
      await nativeExtractAudio({
        taskId: `${taskIdPrefix}-${randomToken()}`,
        sourcePath: sourceNativePath,
        targetPath: targetNativePath,
      });
    } else {
      const { client } = getExportWorkerClient();
      await client.extractAudio(entry.path, targetPath);
    }
  }

  async function batchExtractAudio(entries: FsEntry[], isExternal: boolean) {
    if (isExtracting.value) return;

    const eligibleEntries = entries.filter(
      (e) => e.kind === 'file' && (getMediaTypeFromFilename(e.name) === 'video' || getMediaTypeFromFilename(e.name) === 'audio'),
    );
    if (eligibleEntries.length === 0) return;

    isExtracting.value = true;
    const title = t('videoEditor.fileManager.batchExtractAudio.taskTitle', { count: eligibleEntries.length });
    const bgTaskId = backgroundTasksStore.addTask({
      type: 'conversion',
      title,
      status: 'pending',
    });

    const taskIdPrefix = `audio-extract-batch-${Date.now()}`;
    const total = eligibleEntries.length;
    let completed = 0;
    let lastDirPath = '';

    try {
      backgroundTasksStore.updateTaskStatus(bgTaskId, 'running');
      let noAudioCount = 0;

      for (const entry of eligibleEntries) {
        try {
          const result = await extractSingleAudio(entry, isExternal, taskIdPrefix);
          if (result === 'no-audio') {
            noAudioCount++;
            completed++;
            backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);
            continue;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          backgroundTasksStore.updateTaskStatus(
            bgTaskId,
            'failed',
            `${entry.name}: ${message}`,
          );
          throw err;
        }

        completed++;
        backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);

        if (entry.path) {
          const dirPath = entry.path.split('/').slice(0, -1).join('/');
          lastDirPath = dirPath;
          await fileManager.reloadDirectory(dirPath);
        }
      }

      backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
      backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');

      if (noAudioCount > 0) {
        toast.add({
          title: t('videoEditor.fileManager.batchExtractAudio.noAudioTrack', { count: noAudioCount }),
          color: 'warning',
        });
      }

      if (noAudioCount < eligibleEntries.length) {
        toast.add({
          title: t('videoEditor.fileManager.batchExtractAudio.success'),
          description: title,
          color: 'success',
        });
      }
    } catch {
      const task = backgroundTasksStore.tasks.find((t) => t.id === bgTaskId);
      if (task && task.status !== 'failed') {
        backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', task.error || 'Unknown error');
      }
      toast.add({
        title: t('videoEditor.fileManager.batchExtractAudio.failed'),
        color: 'error',
      });
    } finally {
      isExtracting.value = false;
      if (lastDirPath) {
        await fileManager.reloadDirectory(lastDirPath);
      }
      uiStore.notifyFileManagerUpdate();
    }
  }

  return {
    isExtracting,
    batchExtractAudio,
  };
}
