import { createDevLogger } from '~/utils/dev-logger';
import type { Ref } from 'vue';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import type { RecentProject } from '~/stores/workspace.store';
import { getErrorMessage } from '~/utils/errors';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { ensureDirectoryChain, resolveStorageRootHandle } from '~/utils/storage-handles';
import { renameDirectoryFallback } from '~/file-manager/fs/ops';
const log = createDevLogger('workspaceProjects');

export interface WorkspaceProjectsModule {
  loadProjects: () => Promise<void>;
  clearVardata: () => Promise<void>;
  clearProjectVardata: (projectId: string) => Promise<void>;
  deleteProject: (name: string, projectId?: string) => Promise<void>;
  renameProject: (oldName: string, newName: string) => Promise<void>;
}

interface MovableDirectoryHandle extends FileSystemDirectoryHandle {
  move?: (newName: string) => Promise<void>;
}

export function createWorkspaceProjectsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  projects: Ref<string[]>;
  error: Ref<string | null>;
  lastProjectName: Ref<string | null>;
  recentProjects: Ref<RecentProject[]>;
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
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
    if (!params.projectsHandle.value) return;

    params.projects.value = [];
    try {
      const handleLike = params.projectsHandle.value as unknown as {
        values?: () => AsyncIterableIterator<FileSystemHandle>;
        entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
      };
      const iterator = handleLike.values?.() ?? handleLike.entries?.();
      if (!iterator) return;

      for await (const value of iterator) {
        const handle = Array.isArray(value) ? value[1] : value;
        if (handle.kind === 'directory') {
          params.projects.value.push(handle.name);
        }
      }

      params.projects.value.sort((a, b) => a.localeCompare(b));
    } catch (e: unknown) {
      params.error.value = getErrorMessage(e, 'Failed to load projects');
    }
  }

  async function clearVardata() {
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
    if (!params.projectsHandle.value) return;

    try {
      if (projectId) {
        await clearProjectVardata(projectId);
      }

      await params.projectsHandle.value.removeEntry(name, { recursive: true });
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
    if (!params.projectsHandle.value) return;
    if (oldName === newName) return;
    if (params.projects.value.includes(newName)) {
      params.error.value = `Project with name "${newName}" already exists`;
      return;
    }

    try {
      const oldHandle = (await params.projectsHandle.value.getDirectoryHandle(
        oldName,
      )) as MovableDirectoryHandle;
      // modern File System Access API supports move()
      if (typeof oldHandle.move === 'function') {
        await oldHandle.move(newName);
      } else {
        await renameDirectoryFallback({
          sourceDirHandle: oldHandle,
          sourceName: oldName,
          parentDirHandle: params.projectsHandle.value,
          newName,
        });
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
  }

  return {
    loadProjects,
    clearVardata,
    clearProjectVardata,
    deleteProject,
    renameProject,
  };
}
