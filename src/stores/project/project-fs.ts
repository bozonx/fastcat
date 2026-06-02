import { createDevLogger } from '~/utils/dev-logger';
import type { Ref } from 'vue';
import {
  isWorkspaceCommonPath,
  normalizeWorkspaceFilePath,
  stripWorkspaceCommonPathPrefix,
  toWorkspaceCommonPath,
} from '~/utils/workspace-common';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { VfsNotFoundError } from '~/file-manager/core/vfs/errors';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
const log = createDevLogger('project-fs');

export interface ProjectFsModule {
  toProjectRelativePath: (path: string) => string;
  getProjectFileHandleByRelativePath: (input: {
    relativePath: string;
    create?: boolean;
  }) => Promise<FileSystemFileHandle | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  getDirectoryHandleByPath: (
    path: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemDirectoryHandle | null>;
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  /** Read file text by VFS path. Returns null if file is missing. */
  readTextByPath: (path: string) => Promise<string | null>;
  /** Write text to a VFS path (atomic, governed). */
  writeTextByPath: (path: string, text: string) => Promise<void>;
  /** Write binary/text data to a VFS path (atomic, governed). */
  writeFileByPath: (path: string, data: Blob | Uint8Array | string) => Promise<void>;
  /** Delete a file or directory by VFS path. Missing paths resolve silently. */
  deleteByPath: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  /** List entry names in a VFS directory. Returns [] if directory missing. */
  listEntryNames: (path: string) => Promise<string[]>;
  /** Check if a VFS path exists. */
  pathExists: (path: string) => Promise<boolean>;
  /** Get file metadata (lastModified, size). Returns null if missing. */
  getFileMetadata: (path: string) => Promise<{ lastModified: number; size: number } | null>;
}

export function createProjectFsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectDirHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectName: Ref<string | null>;
  /**
   * Lazily resolves the application VFS adapter. Lazy (not eager) because this
   * module is constructed during project-store setup, which can run before the
   * Nuxt VFS plugin has provided `$vfs`.
   */
  getVfs: () => IFileSystemAdapter;
}) {
  const workspaceTopology = getWorkspaceStorageTopology();

  function toProjectRelativePath(path: string): string {
    return normalizeWorkspaceFilePath(path);
  }

  // ===========================================================================
  // Handle-returning methods.
  //
  // IMPORTANT: these resolve REAL platform directory/file handles from the
  // workspace provider. They are the *ground truth* the VFS adapters are built
  // on (`createTauriWorkspaceAdapters` reads `getProjectDirHandle().path`), so
  // they must NOT be reimplemented in terms of the VFS — that would be circular.
  // ===========================================================================

  async function getWorkspaceCommonDirHandle(
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    if (params.workspaceHandle.value) {
      try {
        return await params.workspaceHandle.value.getDirectoryHandle(
          workspaceTopology.commonDirName,
          { create },
        );
      } catch {
        return null;
      }
    }

    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      const { useWorkspaceStore } = await import('~/stores/workspace.store');
      const workspaceStore = useWorkspaceStore();
      const commonRoot = workspaceStore.resolvedStorageTopology.commonRoot;
      if (commonRoot) {
        const { resolve } = await import('@tauri-apps/api/path');
        const { TauriDirectoryHandle } = await import('~/stores/workspace/provider/tauri-handle');
        try {
          const absoluteCommon = await resolve(commonRoot);
          return new TauriDirectoryHandle(
            absoluteCommon,
            'common',
          ) as unknown as FileSystemDirectoryHandle;
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  async function getProjectFileHandleByRelativePath(input: {
    relativePath: string;
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    const normalizedPath = toProjectRelativePath(input.relativePath);
    if (!normalizedPath) return null;

    if (isWorkspaceCommonPath(normalizedPath)) {
      const commonDir = await getWorkspaceCommonDirHandle(input.create ?? false);
      if (!commonDir) return null;

      const commonRelativePath = stripWorkspaceCommonPathPrefix(normalizedPath);
      if (!commonRelativePath) return null;

      const parts = commonRelativePath.split('/').filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) return null;

      try {
        let currentDir = commonDir;
        for (const dirName of parts) {
          currentDir = await currentDir.getDirectoryHandle(dirName, {
            create: input.create ?? false,
          });
        }

        return await currentDir.getFileHandle(fileName, {
          create: input.create ?? false,
        });
      } catch (e: unknown) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          log.error('Failed to get common file handle by path:', input.relativePath, e);
        }
        return null;
      }
    }

    const projectDir = await getProjectDirHandle();
    if (projectDir) {
      const parts = normalizedPath.split('/').filter(Boolean);
      const fileName = parts.pop();
      if (fileName) {
        try {
          let currentDir = projectDir;
          for (const dirName of parts) {
            currentDir = await currentDir.getDirectoryHandle(dirName, {
              create: input.create ?? false,
            });
          }

          return await currentDir.getFileHandle(fileName, {
            create: input.create ?? false,
          });
        } catch (e) {
          if ((e as { name?: unknown }).name !== 'NotFoundError') {
            if ((e as { name?: unknown }).name !== 'TypeMismatchError') {
              log.error('Failed to get project file handle by path:', input.relativePath, e);
            }
            return null;
          }
          // NotFoundError: fall through to workspace root fallback
        }
      }
    }

    // Fallback: try to resolve from workspace root
    if (!params.workspaceHandle.value) return null;
    const parts = normalizedPath.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return null;

    try {
      let currentDir = params.workspaceHandle.value;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: input.create ?? false,
        });
      }
      return await currentDir.getFileHandle(fileName, {
        create: input.create ?? false,
      });
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        log.error('Failed to get workspace file handle by path:', input.relativePath, e);
      }
      return null;
    }
  }

  async function getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null> {
    return await getProjectFileHandleByRelativePath({ relativePath: path, create: false });
  }

  async function getFileByPath(path: string): Promise<File | null> {
    const fileHandle = await getFileHandleByPath(path);
    if (!fileHandle) return null;

    try {
      return await withFileIoSlot(() => fileHandle.getFile());
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        log.error('Failed to read file by path:', path, e);
      }
      return null;
    }
  }

  async function getDirectoryHandleByPath(
    path: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle | null> {
    const normalizedPath = toProjectRelativePath(path);

    if (!normalizedPath) {
      return await getProjectDirHandle();
    }

    if (isWorkspaceCommonPath(normalizedPath)) {
      const commonDir = await getWorkspaceCommonDirHandle(options?.create ?? false);
      if (!commonDir) return null;

      const commonRelativePath = stripWorkspaceCommonPathPrefix(
        toWorkspaceCommonPath(normalizedPath),
      );
      if (!commonRelativePath) return commonDir;

      try {
        let currentDir = commonDir;
        for (const dirName of commonRelativePath.split('/').filter(Boolean)) {
          currentDir = await currentDir.getDirectoryHandle(dirName, {
            create: options?.create ?? false,
          });
        }

        return currentDir;
      } catch (e: unknown) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          log.error('Failed to get common directory handle by path:', path, e);
        }
        return null;
      }
    }

    const projectDir = await getProjectDirHandle();
    if (projectDir) {
      try {
        let currentDir = projectDir;
        for (const dirName of normalizedPath.split('/').filter(Boolean)) {
          currentDir = await currentDir.getDirectoryHandle(dirName, {
            create: options?.create ?? false,
          });
        }
        return currentDir;
      } catch (e) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          if ((e as { name?: unknown }).name !== 'TypeMismatchError') {
            log.error('Failed to get project directory handle by path:', path, e);
          }
          return null;
        }
        // NotFoundError: fall through to workspace root fallback
      }
    }

    // Fallback: try to resolve from workspace root
    if (!params.workspaceHandle.value) return null;
    try {
      let currentDir = params.workspaceHandle.value;
      for (const dirName of normalizedPath.split('/').filter(Boolean)) {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: options?.create ?? false,
        });
      }
      return currentDir;
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        log.error('Failed to get workspace directory handle by path:', path, e);
      }
      return null;
    }
  }

  async function getProjectDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (params.currentProjectDirHandle.value) {
      return params.currentProjectDirHandle.value;
    }
    if (!params.projectsHandle.value || !params.currentProjectName.value) return null;
    try {
      return await params.projectsHandle.value.getDirectoryHandle(params.currentProjectName.value);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // VFS path-based methods (atomic writes, typed errors). Used by callers that
  // only need read/write/list by path — they route through the application VFS
  // (active project = default route, `@common/…` = workspace common).
  // ===========================================================================

  /** Resolve a workspace-relative path to the routed VFS path. */
  function resolveVfsPath(path: string): string {
    const normalized = toProjectRelativePath(path);
    if (!normalized) return '';
    if (isWorkspaceCommonPath(normalized)) return toWorkspaceCommonPath(normalized);
    return normalized;
  }

  async function readTextByPath(path: string): Promise<string | null> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) return null;
    try {
      const blob = await params.getVfs().readFile(vfsPath);
      const text = await blob.text();
      return text.trim() || null;
    } catch (e) {
      if (e instanceof VfsNotFoundError) return null;
      throw e;
    }
  }

  async function writeTextByPath(path: string, text: string): Promise<void> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) throw new Error(`Invalid VFS path: ${path}`);
    await params.getVfs().writeFile(vfsPath, text);
  }

  async function writeFileByPath(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) throw new Error(`Invalid VFS path: ${path}`);
    await params.getVfs().writeFile(vfsPath, data);
  }

  async function deleteByPath(path: string, options?: { recursive?: boolean }): Promise<void> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) return;
    await params.getVfs().deleteEntry(vfsPath, options?.recursive ?? false);
  }

  async function listEntryNames(path: string): Promise<string[]> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) return [];
    try {
      return await params.getVfs().listEntryNames(vfsPath);
    } catch {
      return [];
    }
  }

  async function pathExists(path: string): Promise<boolean> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) return false;
    return params.getVfs().exists(vfsPath);
  }

  async function getFileMetadata(
    path: string,
  ): Promise<{ lastModified: number; size: number } | null> {
    const vfsPath = resolveVfsPath(path);
    if (!vfsPath) return null;
    const meta = await params.getVfs().getMetadata(vfsPath);
    if (!meta || meta.kind !== 'file') return null;
    return { lastModified: meta.lastModified, size: meta.size };
  }

  const module: ProjectFsModule = {
    toProjectRelativePath,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getFileByPath,
    getDirectoryHandleByPath,
    getProjectDirHandle,
    readTextByPath,
    writeTextByPath,
    writeFileByPath,
    deleteByPath,
    listEntryNames,
    pathExists,
    getFileMetadata,
  };

  return module;
}
