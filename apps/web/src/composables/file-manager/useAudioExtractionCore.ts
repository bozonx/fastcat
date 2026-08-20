import type { FsEntry } from '~/types/fs';
import { getExportWorkerClient, runWithExportHostApi } from '~/utils/video-editor/worker-client';
import { createProjectHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeExtractAudio,
  nativeMediaMetadata,
} from '~/utils/tauri-media-processing';
import { randomToken } from '~/utils/ids';

export type AudioExtractionResult =
  | { status: 'no-audio' }
  | { status: 'extracted'; targetPath: string; newFileName: string; dirPath: string };

/**
 * Shared mechanics for extracting an audio track from a single media file,
 * used by both the single (`useAudioExtraction`) and batch
 * (`useBatchAudioExtraction`) flows. Resolves the source (native path or worker
 * file), reads metadata, picks an output extension, finds a conflict-free
 * target path, creates the target handle and runs the extraction. UI concerns
 * (toasts, progress, navigation, selection) stay with the callers.
 */
export function useAudioExtractionCore() {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();

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

  async function extractAudioFile(
    entry: FsEntry,
    opts: { isExternal: boolean; taskIdPrefix: string },
  ): Promise<AudioExtractionResult | undefined> {
    if (!entry.path) return;

    const { isExternal, taskIdPrefix } = opts;
    const vfs = fileManager.vfs;
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

      // Worker host API must return native FileSystemFileHandle (clonable via postMessage).
      // For workspace context: resolve from workspace root directly to avoid
      // projectStore resolving into the project directory.
      // For project context: use projectStore (original behavior).
      meta = await runWithExportHostApi(
        createProjectHostApi({
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
        }),
        async () => {
          const { client } = getExportWorkerClient();
          return await client.extractMetadata(sourceFile);
        },
      );
    }

    if (!meta.audio) {
      return { status: 'no-audio' };
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
        taskId: `${taskIdPrefix}-${randomToken()}`,
        sourcePath: sourceNativePath,
        targetPath: targetNativePath,
      });
    } else {
      await runWithExportHostApi(
        createProjectHostApi({
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
        }),
        async () => {
          const { client } = getExportWorkerClient();
          await client.extractAudio(entry.path, targetPath);
        },
      );
    }

    return { status: 'extracted', targetPath, newFileName, dirPath };
  }

  return {
    getWorkspaceFileHandle,
    extractAudioFile,
  };
}
