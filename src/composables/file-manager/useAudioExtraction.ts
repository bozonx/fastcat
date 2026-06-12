import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed, inject, nextTick } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeExtractAudio,
  nativeMediaMetadata,
} from '~/utils/tauri-media-processing';
import { randomToken } from '~/utils/ids';
const log = createDevLogger('useAudioExtraction');

interface AudioExtractionSelectionContext {
  instanceId?: string;
  isExternal?: boolean;
}

export function useAudioExtraction() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const toast = useToast();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();

  // Resolve the correct file manager store for the current context.
  // ComputerFileManager injects its own sidebar store; other contexts use the global one.
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ??
    useFileManagerStore();

  const isExtracting = computed({
    get: () => uiStore.isExtractingAudio,
    set: (val) => {
      uiStore.isExtractingAudio = val;
      if (!val) {
        uiStore.extractingAudioError = null;
      }
    },
  });

  // Resolve a native FileSystemFileHandle directly from the workspace root handle.
  // Bypasses projectStore entirely so workspace-relative paths never accidentally
  // resolve to the project directory. Returns clonable handles for postMessage.
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

  async function extractAudio(entry: FsEntry, context: AudioExtractionSelectionContext = {}) {
    if (isExtracting.value) return;
    if (!entry.path) return;

    uiStore.extractingAudioError = null;
    isExtracting.value = true;
    try {
      const selectedEntityBeforeNavigation = selectionStore.selectedEntity;
      const selectionContext = {
        instanceId:
          context.instanceId ??
          (selectedEntityBeforeNavigation?.source === 'fileManager'
            ? selectedEntityBeforeNavigation.instanceId
            : undefined),
        isExternal:
          context.isExternal ??
          (selectedEntityBeforeNavigation?.source === 'fileManager'
            ? selectedEntityBeforeNavigation.isExternal
            : undefined),
      };
      const vfs = fileManager.vfs;
      const isExternal = context.isExternal === true;
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
        // For workspace file manager (isExternal), resolve from workspace root directly.
        // For project file manager, use projectStore which resolves from project dir.
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

        // Worker host API must return native FileSystemFileHandle (clonable via postMessage).
        // For workspace context: resolve from workspace root directly to avoid
        // projectStore resolving into the project directory.
        // For project context: use projectStore (original behavior).
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
      if (!meta.audio) throw new Error('No audio track found in file');

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

      // Check for naming conflicts via VFS (works for both project and workspace file managers)
      let newFileName = `${baseName}_extracted.${ext}`;
      let counter = 2;
      while (await vfs.exists(dirPath ? `${dirPath}/${newFileName}` : newFileName)) {
        newFileName = `${baseName}_extracted (${counter}).${ext}`;
        counter++;
      }

      const targetPath = dirPath ? `${dirPath}/${newFileName}` : newFileName;

      // Pre-create the target file in the correct directory.
      // Workspace context: create via workspace handle directly.
      // Project context: create via projectStore.
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
          taskId: `audio-extract-${Date.now()}-${randomToken()}`,
          sourcePath: sourceNativePath,
          targetPath: targetNativePath,
        });
      } else {
        const { client } = getExportWorkerClient();
        await client.extractAudio(entry.path, targetPath);
      }

      toast.add({
        title: t('videoEditor.fileManager.extractAudio.success'),
        color: 'success',
      });

      const uiStore = useUiStore();

      // Expand the parent directory in the tree view before reloading
      if (dirPath) {
        uiStore.setFileTreePathExpanded(dirPath, true);
      }

      await fileManager.reloadDirectory(dirPath);

      // Navigate the flat file browser to the directory containing the new file
      const folderEntry: FsEntry = {
        kind: 'directory',
        path: dirPath,
        name: dirPath
          ? (dirPath.split('/').pop() ?? dirPath)
          : (projectStore.currentProjectName ?? '/'),
        parentPath: dirPath ? dirPath.split('/').slice(0, -1).join('/') || undefined : undefined,
      };
      fileManagerStore.openFolder(folderEntry, {
        skipHistory: !dirPath,
        selectionContext,
      });

      uiStore.notifyFileManagerUpdate();
      await nextTick();

      const newEntry =
        fileManager.findEntryByPath(targetPath) ??
        (await fileManager.resolveEntryByPath(targetPath)) ??
        ({
          kind: 'file',
          name: newFileName,
          path: targetPath,
          parentPath: dirPath || undefined,
          source: entry.source ?? 'local',
        } as FsEntry);

      selectionStore.selectFsEntryWithUiUpdate(
        newEntry,
        selectionContext.instanceId,
        selectionContext.isExternal,
      );
      if (typeof fileManagerStore.selectItem === 'function') {
        fileManagerStore.selectItem(newEntry, selectionContext);
      }

      // Scroll the tree view to make the new entry visible
      uiStore.triggerScrollToFileTreeEntry(targetPath);
    } catch (err: unknown) {
      log.error('Audio extraction failed', err);
      const e = err instanceof Error ? err : null;
      uiStore.extractingAudioError = e?.message ?? 'Unknown error';
      toast.add({
        title: t('videoEditor.fileManager.extractAudio.failed'),
        description: e?.message ?? 'Unknown error',
        color: 'error',
      });
    } finally {
      if (!uiStore.extractingAudioError) {
        isExtracting.value = false;
      }
    }
  }

  return {
    isExtracting,
    extractAudio,
  };
}
