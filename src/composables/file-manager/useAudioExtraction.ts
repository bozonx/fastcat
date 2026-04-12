import { ref, inject } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerStore } from '~/stores/file-manager.store';

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

  // Resolve the correct file manager store for the current context.
  // ComputerFileManager injects its own sidebar store; other contexts use the global one.
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ??
    useFileManagerStore();

  const isExtracting = ref(false);

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

    isExtracting.value = true;
    try {
      const vfs = fileManager.vfs;
      const isExternal = context.isExternal === true;

      // For workspace file manager (isExternal), resolve from workspace root directly.
      // For project file manager, use projectStore which resolves from project dir.
      let sourceFile: File | null = null;
      if (isExternal) {
        const handle = await getWorkspaceFileHandle(entry.path);
        if (handle) {
          try {
            sourceFile = await handle.getFile();
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
                  return await handle.getFile();
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

      const meta = await client.extractMetadata(sourceFile);
      if (!meta.audio) throw new Error('No audio track found in file');

      const codec = meta.audio.codec || '';
      const lowercaseCodec = codec.toLowerCase();

      let ext = 'mka';
      if (lowercaseCodec.startsWith('mp4a') || lowercaseCodec.includes('aac')) {
        ext = 'm4a';
      } else if (lowercaseCodec.includes('opus')) {
        ext = 'opus';
      } else if (lowercaseCodec.includes('mp3')) {
        ext = 'mp3';
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
      if (isExternal) {
        await getWorkspaceFileHandle(targetPath, { create: true });
      } else {
        const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
        if (dirHandle) {
          await dirHandle.getFileHandle(newFileName, { create: true });
        }
      }

      await client.extractAudio(entry.path, targetPath);

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
      fileManagerStore.openFolder(folderEntry, { skipHistory: !dirPath });

      uiStore.notifyFileManagerUpdate();

      const newEntry =
        fileManager.findEntryByPath(targetPath) ??
        (await fileManager.resolveEntryByPath(targetPath));
      if (newEntry) {
        const selectedEntity = selectionStore.selectedEntity;
        const nextInstanceId =
          context.instanceId ??
          (selectedEntity?.source === 'fileManager' ? selectedEntity.instanceId : undefined);
        const nextIsExternal =
          context.isExternal ??
          (selectedEntity?.source === 'fileManager' ? selectedEntity.isExternal : undefined);

        selectionStore.selectFsEntryWithUiUpdate(newEntry, nextInstanceId, nextIsExternal);

        // Scroll the tree view to make the new entry visible
        uiStore.triggerScrollToFileTreeEntry(targetPath);
      }
    } catch (err: any) {
      console.error('Audio extraction failed', err);
      toast.add({
        title: t('videoEditor.fileManager.extractAudio.failed'),
        description: err.message,
        color: 'error',
      });
    } finally {
      isExtracting.value = false;
    }
  }

  return {
    isExtracting,
    extractAudio,
  };
}
