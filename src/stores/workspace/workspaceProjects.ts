import type { Ref } from 'vue';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { toStoragePathSegments } from '~/utils/storage-topology';
import { ensureDirectoryChain, resolveStorageRootHandle } from '~/utils/storage-handles';

function getErrorMessage(e: unknown, fallback: string): string {
  if (!e || typeof e !== 'object') return fallback;
  if (!('message' in e)) return fallback;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}

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
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
}): WorkspaceProjectsModule {
  const workspaceTopology = getWorkspaceStorageTopology();

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
    const tempRootSegments = toStoragePathSegments(params.resolvedStorageTopology.value.tempRoot);
    const tempRootDirName = tempRootSegments[0] ?? workspaceTopology.tempRootDirName;
    try {
      await params.workspaceHandle.value.removeEntry(tempRootDirName, {
        recursive: true,
      });
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        console.warn('Failed to clear vardata', e);
      }
    }
    try {
      let currentDir = params.workspaceHandle.value;
      for (const segment of tempRootSegments.length > 0
        ? tempRootSegments
        : [workspaceTopology.tempRootDirName]) {
        currentDir = await currentDir.getDirectoryHandle(segment, { create: true });
      }
    } catch {
      // ignore
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
  }

  async function deleteProject(name: string, projectId?: string) {
    if (!params.projectsHandle.value) return;

    try {
      if (projectId) {
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
      }

      await params.projectsHandle.value.removeEntry(name, { recursive: true });
      await loadProjects();

      if (params.lastProjectName.value === name) {
        params.lastProjectName.value = null;
      }
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        console.warn('Failed to delete project', name, e);
        throw e;
      }
    }
  }

  async function renameProject(oldName: string, newName: string) {
    if (!params.projectsHandle.value) return;
    if (oldName === newName) return;

    try {
      const oldHandle = await params.projectsHandle.value.getDirectoryHandle(oldName);
      // modern File System Access API supports move()
      if (typeof (oldHandle as any).move === 'function') {
        await (oldHandle as any).move(newName);
      } else {
        // Fallback or error
        throw new Error('Directory move is not supported in this browser');
      }

      await loadProjects();

      if (params.lastProjectName.value === oldName) {
        params.lastProjectName.value = newName;
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
