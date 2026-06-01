import { createDevLogger } from '~/utils/dev-logger';
import type { Ref } from 'vue';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import type { RecentProject } from '~/stores/workspace.store';
import { getErrorMessage } from '~/utils/errors';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { ensureDirectoryChain, resolveStorageRootHandle } from '~/utils/storage-handles';
import { toProjectStoragePath } from '~/utils/workspace-common';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
const log = createDevLogger('workspaceProjects');

export interface WorkspaceProjectsModule {
  loadProjects: () => Promise<void>;
  clearVardata: () => Promise<void>;
  clearProjectVardata: (projectId: string) => Promise<void>;
  deleteProject: (name: string, projectId?: string) => Promise<void>;
  renameProject: (oldName: string, newName: string) => Promise<void>;
}

export function createWorkspaceProjectsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  projects: Ref<string[]>;
  error: Ref<string | null>;
  lastProjectName: Ref<string | null>;
  recentProjects: Ref<RecentProject[]>;
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
  /** Lazily resolves the application VFS adapter (see project-fs for rationale). */
  getVfs: () => IFileSystemAdapter;
}): WorkspaceProjectsModule {
  const workspaceTopology = getWorkspaceStorageTopology();

  async function clearDirectoryContents(dir: FileSystemDirectoryHandle) {
    const handleLike = dir as unknown as {
      values?: () => AsyncIterableIterator<FileSystemHandle>;
      entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    const iterator = handleLike.values?.() ?? handleLike.entries?.();
    if (!iterator) return;

    for await (const value of iterator) {
      const entry = Array.isArray(value) ? value[1] : value;
      await dir.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
    }
  }

  async function loadProjects() {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      try {
        const { readDir, exists } = await import('@tauri-apps/plugin-fs');
        const projectsPath = params.resolvedStorageTopology.value.projectsRoot;
        if (await exists(projectsPath)) {
          const entries = await readDir(projectsPath);
          const tempProjects = entries
            .filter((entry) => entry.isDirectory)
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
          params.projects.value = tempProjects;
        }
      } catch (e: unknown) {
        params.error.value = getErrorMessage(e, 'Failed to load projects');
      }
      return;
    }

    if (!params.projectsHandle.value) return;

    try {
      const entries = await params.getVfs().readDirectory(toProjectStoragePath(''));
      const tempProjects = entries
        .filter((entry) => entry.kind === 'directory')
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      params.projects.value = tempProjects;
    } catch (e: unknown) {
      params.error.value = getErrorMessage(e, 'Failed to load projects');
    }
  }

  async function clearVardata() {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      try {
        const { remove, exists, mkdir } = await import('@tauri-apps/plugin-fs');
        const rootPaths = [
          params.resolvedStorageTopology.value.tempRoot,
          params.resolvedStorageTopology.value.proxiesRoot,
        ];
        const uniqueRootPaths = [...new Set(rootPaths.filter((path) => path.trim().length > 0))];
        for (const rootPath of uniqueRootPaths) {
          if (await exists(rootPath)) {
            await remove(rootPath, { recursive: true });
            await mkdir(rootPath, { recursive: true });
          }
        }
      } catch (e: unknown) {
        log.warn('Failed to clear Tauri vardata', e);
      }
      return;
    }

    if (!params.workspaceHandle.value) return;
    const rootPaths = [
      params.resolvedStorageTopology.value.tempRoot,
      params.resolvedStorageTopology.value.proxiesRoot,
    ];
    const uniqueRootPaths = [...new Set(rootPaths.filter((path) => path.trim().length > 0))];
    for (const rootPath of uniqueRootPaths) {
      try {
        const rootDir = await resolveStorageRootHandle({
          workspaceHandle: params.workspaceHandle.value,
          rootPath,
          create: true,
        });
        await clearDirectoryContents(rootDir as FileSystemDirectoryHandle);
      } catch (e: unknown) {
        if ((e as { name?: unknown }).name !== 'NotFoundError') {
          log.warn('Failed to clear generated storage root', rootPath, e);
        }
      }
    }

    if (uniqueRootPaths.length === 0) {
      try {
        const tempRootDir = await params.workspaceHandle.value.getDirectoryHandle(
          workspaceTopology.tempRootDirName,
          { create: true },
        );
        await clearDirectoryContents(tempRootDir);
      } catch (e) {
        log.warn('Failed to clear workspace-local temp root', e);
      }
    }
  }

  async function clearProjectVardata(projectId: string) {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      try {
        const { join } = await import('@tauri-apps/api/path');
        const { remove, exists } = await import('@tauri-apps/plugin-fs');

        const tempProjectDir = await join(
          params.resolvedStorageTopology.value.tempRoot,
          workspaceTopology.tempProjectsDirName,
          projectId,
        );
        if (await exists(tempProjectDir)) {
          await remove(tempProjectDir, { recursive: true });
        }

        const proxiesRoot = params.resolvedStorageTopology.value.proxiesRoot.trim();
        if (proxiesRoot) {
          const proxiesProjectDir = await join(
            proxiesRoot,
            workspaceTopology.tempProjectsDirName,
            projectId,
          );
          if (await exists(proxiesProjectDir)) {
            await remove(proxiesProjectDir, { recursive: true });
          }
        }
      } catch (e: unknown) {
        log.warn('Failed to clear Tauri project vardata', projectId, e);
      }
      return;
    }

    try {
      const tempRootDir = await resolveStorageRootHandle({
        workspaceHandle: params.workspaceHandle.value!,
        rootPath: params.resolvedStorageTopology.value.tempRoot,
      });
      const projectsDir = await ensureDirectoryChain({
        baseDir: tempRootDir,
        segments: [workspaceTopology.tempProjectsDirName],
      });
      await projectsDir.removeEntry(projectId, { recursive: true });
    } catch {
      // ignore
    }

    if (params.resolvedStorageTopology.value.proxiesRoot.trim()) {
      try {
        const proxiesRootDir = await resolveStorageRootHandle({
          workspaceHandle: params.workspaceHandle.value!,
          rootPath: params.resolvedStorageTopology.value.proxiesRoot,
        });
        const projectsDir = await ensureDirectoryChain({
          baseDir: proxiesRootDir,
          segments: [workspaceTopology.tempProjectsDirName],
        });
        await projectsDir.removeEntry(projectId, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  async function deleteProject(name: string, projectId?: string) {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      try {
        if (projectId) {
          await clearProjectVardata(projectId);
        }

        const { join } = await import('@tauri-apps/api/path');
        const { remove, exists } = await import('@tauri-apps/plugin-fs');
        const projectPath = await join(params.resolvedStorageTopology.value.projectsRoot, name);
        if (await exists(projectPath)) {
          await remove(projectPath, { recursive: true });
        }
        await loadProjects();

        if (params.lastProjectName.value === name) {
          params.lastProjectName.value = null;
        }

        params.recentProjects.value = params.recentProjects.value.filter(
          (p) => p.projectName !== name,
        );
      } catch (e: unknown) {
        log.warn('Failed to delete project', name, e);
        throw e;
      }
      return;
    }

    if (!params.projectsHandle.value) return;

    try {
      if (projectId) {
        await clearProjectVardata(projectId);
      }

      await params.getVfs().deleteEntry(toProjectStoragePath(name), true);
      await loadProjects();

      if (params.lastProjectName.value === name) {
        params.lastProjectName.value = null;
      }

      params.recentProjects.value = params.recentProjects.value.filter(
        (p) => p.projectName !== name,
      );
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        log.warn('Failed to delete project', name, e);
        throw e;
      }
    }
  }

  async function renameProject(oldName: string, newName: string) {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      if (oldName === newName) return;
      if (params.projects.value.includes(newName)) {
        params.error.value = `Project with name "${newName}" already exists`;
        return;
      }

      try {
        const { join } = await import('@tauri-apps/api/path');
        const { rename, exists } = await import('@tauri-apps/plugin-fs');
        const oldPath = await join(params.resolvedStorageTopology.value.projectsRoot, oldName);
        const newPath = await join(params.resolvedStorageTopology.value.projectsRoot, newName);
        if (await exists(oldPath)) {
          await rename(oldPath, newPath);
        }
        await loadProjects();

        if (params.lastProjectName.value === oldName) {
          params.lastProjectName.value = newName;
        }

        const recentIndex = params.recentProjects.value.findIndex((p) => p.projectName === oldName);
        if (recentIndex !== -1) {
          params.recentProjects.value[recentIndex] = {
            ...params.recentProjects.value[recentIndex],
            projectName: newName,
          } as RecentProject;
        }
      } catch (e: unknown) {
        params.error.value = getErrorMessage(e, 'Failed to rename project');
        throw e;
      }
      return;
    }

    if (!params.projectsHandle.value) return;
    if (oldName === newName) return;
    if (params.projects.value.includes(newName)) {
      params.error.value = `Project with name "${newName}" already exists`;
      return;
    }

    try {
      // VFS moveEntry handles same-adapter rename + cross-device copy/delete fallback.
      await params.getVfs().moveEntry(toProjectStoragePath(oldName), toProjectStoragePath(newName));

      await loadProjects();

      if (params.lastProjectName.value === oldName) {
        params.lastProjectName.value = newName;
      }

      const recentIndex = params.recentProjects.value.findIndex((p) => p.projectName === oldName);
      if (recentIndex !== -1) {
        params.recentProjects.value[recentIndex] = {
          ...params.recentProjects.value[recentIndex],
          projectName: newName,
        } as RecentProject;
      }
    } catch (e: unknown) {
      params.error.value = getErrorMessage(e, 'Failed to rename project');
      throw e;
    }
  }

  return {
    loadProjects,
    clearVardata,
    clearProjectVardata,
    deleteProject,
    renameProject,
  };
}
