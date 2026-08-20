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
  deleteProject: (input: DeleteProjectInput | string, projectId?: string) => Promise<void>;
  forgetProject: (input: DeleteProjectInput | string, projectId?: string) => Promise<void>;
  renameProject: (
    input: RenameProjectInput | string,
    newName?: string,
    projectId?: string,
  ) => Promise<void>;
  duplicateProject: (input: DuplicateProjectInput) => Promise<void>;
}

export interface DeleteProjectInput {
  name: string;
  projectId?: string;
  projectPath?: string;
}

export interface RenameProjectInput {
  oldName: string;
  newName: string;
  projectId?: string;
  projectPath?: string;
}

export interface DuplicateProjectInput {
  sourceName: string;
  targetName: string;
  sourceProjectId?: string;
  sourceProjectPath?: string;
  targetParentPath?: string;
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

  function normalizeDeleteInput(
    input: DeleteProjectInput | string,
    projectId?: string,
  ): DeleteProjectInput {
    if (typeof input === 'string') {
      return { name: input, projectId };
    }
    return input;
  }

  function normalizeRenameInput(
    input: RenameProjectInput | string,
    newName?: string,
    projectId?: string,
  ): RenameProjectInput {
    if (typeof input === 'string') {
      return { oldName: input, newName: newName ?? input, projectId };
    }
    return input;
  }

  function findRecentProject(input: {
    name: string;
    projectId?: string;
    projectPath?: string;
  }): RecentProject | undefined {
    if (input.projectId) {
      const byId = params.recentProjects.value.find(
        (project) => project.projectId === input.projectId,
      );
      if (byId) return byId;
    }

    if (input.projectPath) {
      const byPath = params.recentProjects.value.find(
        (project) => project.projectPath === input.projectPath,
      );
      if (byPath) return byPath;
    }

    return params.recentProjects.value.find((project) => project.projectName === input.name);
  }

  async function loadProjects() {
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      const { readDir, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');

      const projectsRoot = params.resolvedStorageTopology.value.projectsRoot;
      const recentList = [...params.recentProjects.value];
      const recentPaths = new Set(recentList.map((p) => p.projectPath).filter(Boolean));
      const recentNames = new Set(recentList.map((p) => p.projectName));

      let updatedRecent = false;

      try {
        const entries = await readDir(projectsRoot);
        for (const entry of entries) {
          if (entry.isDirectory) {
            const projectPath = await join(projectsRoot, entry.name);

            if (!recentPaths.has(projectPath) && !recentNames.has(entry.name)) {
              let projectId = '';
              let updatedAt = new Date().toISOString();

              const metaPath = await join(projectPath, '.fastcat', 'project.meta.json');
              if (await exists(metaPath)) {
                try {
                  const text = await readTextFile(metaPath);
                  const meta = JSON.parse(text) as Record<string, unknown>;
                  projectId = (meta.id as string) || '';
                  if (meta.updatedAt) {
                    updatedAt = meta.updatedAt as string;
                  }
                } catch (e) {
                  log.warn('Failed to parse meta for auto-detected project', entry.name, e);
                }
              }

              recentList.push({
                projectName: entry.name,
                projectId,
                updatedAt,
                projectPath,
              });
              updatedRecent = true;
            }
          }
        }
      } catch (e: unknown) {
        log.warn('Failed to scan Tauri projects root', e);
      }

      if (updatedRecent) {
        params.recentProjects.value = recentList;
      }

      params.projects.value = recentList
        .map((p) => p.projectName)
        .sort((a, b) => a.localeCompare(b));
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
        const { exists, mkdir } = await import('@tauri-apps/plugin-fs');
        const { TauriDirectoryHandle } = await import('~/stores/workspace/provider/tauri-handle');
        const rootPaths = [
          params.resolvedStorageTopology.value.tempRoot,
          params.resolvedStorageTopology.value.proxiesRoot,
        ];
        const uniqueRootPaths = [...new Set(rootPaths.filter((path) => path.trim().length > 0))];
        for (const rootPath of uniqueRootPaths) {
          if (await exists(rootPath)) {
            await clearDirectoryContents(
              new TauriDirectoryHandle(
                rootPath,
                rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'root',
              ) as unknown as FileSystemDirectoryHandle,
            );
          } else {
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

  function isProjectInStandardFolder(projectPath: string | undefined): boolean {
    if (!projectPath) return true;
    const root = params.resolvedStorageTopology.value.projectsRoot;
    if (!root) return true;
    const normPath = projectPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    return normPath === normRoot || normPath.startsWith(normRoot + '/');
  }

  async function deleteProject(input: DeleteProjectInput | string, projectId?: string) {
    const deleteInput = normalizeDeleteInput(input, projectId);
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      // External projects (opened from arbitrary disk locations) cannot be
      // physically deleted — only removed from the recent list.
      if (!isProjectInStandardFolder(deleteInput.projectPath)) {
        await forgetProject(deleteInput);
        return;
      }

      // Standard-folder projects: physically remove from disk.
      try {
        const { join } = await import('@tauri-apps/api/path');
        const { remove, exists } = await import('@tauri-apps/plugin-fs');

        const project = findRecentProject({
          name: deleteInput.name,
          projectId: deleteInput.projectId,
          projectPath: deleteInput.projectPath,
        });
        let projectPath = deleteInput.projectPath ?? project?.projectPath;
        if (!projectPath) {
          const fallbackPath = await join(
            params.resolvedStorageTopology.value.projectsRoot,
            deleteInput.name,
          );
          if (await exists(fallbackPath)) {
            projectPath = fallbackPath;
          } else {
            // Folder not found — just forget.
            await forgetProject(deleteInput);
            return;
          }
        }

        if (deleteInput.projectId) {
          await clearProjectVardata(deleteInput.projectId);
        }

        if (await exists(projectPath)) {
          await remove(projectPath, { recursive: true });
        }

        if (params.lastProjectName.value === deleteInput.name) {
          params.lastProjectName.value = null;
        }

        params.recentProjects.value = params.recentProjects.value.filter((recent) => {
          if (deleteInput.projectId) return recent.projectId !== deleteInput.projectId;
          if (deleteInput.projectPath) return recent.projectPath !== deleteInput.projectPath;
          return recent.projectName !== deleteInput.name;
        });

        await loadProjects();
      } catch (e: unknown) {
        log.warn('Failed to delete Tauri project', deleteInput.name, e);
        params.error.value = getErrorMessage(e, 'Failed to delete project');
        throw e;
      }
      return;
    }

    if (!params.projectsHandle.value) return;

    try {
      if (deleteInput.projectId) {
        await clearProjectVardata(deleteInput.projectId);
      }

      await params.getVfs().deleteEntry(toProjectStoragePath(deleteInput.name), true);

      if (params.lastProjectName.value === deleteInput.name) {
        params.lastProjectName.value = null;
      }

      params.recentProjects.value = params.recentProjects.value.filter(
        (p) => p.projectName !== deleteInput.name,
      );

      await loadProjects();
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name !== 'NotFoundError') {
        log.warn('Failed to delete project', deleteInput.name, e);
        throw e;
      }
    }
  }

  async function forgetProject(input: DeleteProjectInput | string, projectId?: string) {
    const forgetInput = normalizeDeleteInput(input, projectId);

    try {
      if (forgetInput.projectId) {
        await clearProjectVardata(forgetInput.projectId);
      }
    } catch (e: unknown) {
      log.warn('Failed to clear project vardata during forget', forgetInput.name, e);
    }

    if (params.lastProjectName.value === forgetInput.name) {
      params.lastProjectName.value = null;
    }

    params.recentProjects.value = params.recentProjects.value.filter((recent) => {
      if (forgetInput.projectId) return recent.projectId !== forgetInput.projectId;
      if (forgetInput.projectPath) return recent.projectPath !== forgetInput.projectPath;
      return recent.projectName !== forgetInput.name;
    });

    await loadProjects();
  }

  async function renameProject(
    input: RenameProjectInput | string,
    newNameArg?: string,
    projectId?: string,
  ) {
    const renameInput = normalizeRenameInput(input, newNameArg, projectId);
    const { oldName, newName } = renameInput;
    const { isTauriRuntime } = await import('~/utils/runtime');
    if (isTauriRuntime()) {
      if (oldName === newName) return;

      try {
        const { join, dirname } = await import('@tauri-apps/api/path');
        const { rename, exists } = await import('@tauri-apps/plugin-fs');
        const project = findRecentProject({
          name: oldName,
          projectId: renameInput.projectId,
          projectPath: renameInput.projectPath,
        });
        let oldPath = renameInput.projectPath ?? project?.projectPath;
        if (!oldPath) {
          const fallbackPath = await join(
            params.resolvedStorageTopology.value.projectsRoot,
            oldName,
          );
          if (await exists(fallbackPath)) {
            oldPath = fallbackPath;
          } else {
            params.error.value = `Cannot resolve project path for "${oldName}"`;
            return;
          }
        }
        const parentDir = await dirname(oldPath);
        const newPath = await join(parentDir, newName);

        if (await exists(newPath)) {
          params.error.value = `Project with name "${newName}" already exists`;
          return;
        }

        if (await exists(oldPath)) {
          await rename(oldPath, newPath);
        }

        const recentIndex = params.recentProjects.value.findIndex((recent) => {
          if (renameInput.projectId) return recent.projectId === renameInput.projectId;
          if (oldPath) return recent.projectPath === oldPath;
          return recent.projectName === oldName;
        });
        if (recentIndex !== -1) {
          params.recentProjects.value[recentIndex] = {
            ...params.recentProjects.value[recentIndex],
            projectName: newName,
            projectPath: newPath,
          } as RecentProject;
        }

        if (params.lastProjectName.value === oldName) {
          params.lastProjectName.value = newName;
        }

        await loadProjects();
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

      const recentIndex = params.recentProjects.value.findIndex((p) => p.projectName === oldName);
      if (recentIndex !== -1) {
        params.recentProjects.value[recentIndex] = {
          ...params.recentProjects.value[recentIndex],
          projectName: newName,
        } as RecentProject;
      }

      if (params.lastProjectName.value === oldName) {
        params.lastProjectName.value = newName;
      }

      await loadProjects();
    } catch (e: unknown) {
      params.error.value = getErrorMessage(e, 'Failed to rename project');
      throw e;
    }
  }

  async function copyTauriProjectRecursively(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const { readDir, mkdir, copyFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const entries = await readDir(sourcePath);
    await mkdir(targetPath, { recursive: true });
    for (const entry of entries) {
      const srcChild = await join(sourcePath, entry.name);
      const tgtChild = await join(targetPath, entry.name);
      if (entry.isDirectory) {
        if (srcChild.endsWith('/.fastcat/backups') || srcChild.endsWith('\\.fastcat\\backups')) {
          continue;
        }
        if (srcChild.endsWith('/.fastcat/autosave') || srcChild.endsWith('\\.fastcat\\autosave')) {
          continue;
        }
        await copyTauriProjectRecursively(srcChild, tgtChild);
      } else {
        await copyFile(srcChild, tgtChild);
      }
    }
  }

  async function duplicateProject(input: DuplicateProjectInput) {
    const { sourceName, targetName } = input;
    const { isTauriRuntime } = await import('~/utils/runtime');
    const { genUuid } = await import('~/utils/ids');

    if (isTauriRuntime()) {
      const { join, dirname } = await import('@tauri-apps/api/path');
      const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');

      const project = findRecentProject({
        name: sourceName,
        projectId: input.sourceProjectId,
        projectPath: input.sourceProjectPath,
      });
      let sourcePath = input.sourceProjectPath ?? project?.projectPath;
      if (!sourcePath) {
        const fallbackPath = await join(
          params.resolvedStorageTopology.value.projectsRoot,
          sourceName,
        );
        if (await exists(fallbackPath)) {
          sourcePath = fallbackPath;
        } else {
          params.error.value = `Cannot resolve project path for "${sourceName}"`;
          return;
        }
      }
      const parentDir = input.targetParentPath ?? (await dirname(sourcePath));
      const targetPath = await join(parentDir, targetName);

      if (await exists(targetPath)) {
        params.error.value = `Project with name "${targetName}" already exists`;
        return;
      }

      await copyTauriProjectRecursively(sourcePath, targetPath);

      const metaPath = await join(targetPath, '.fastcat', 'project.meta.json');
      let meta: Record<string, unknown> = {};
      try {
        const text = await readTextFile(metaPath);
        meta = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // fresh meta if missing
      }
      meta.id = genUuid();
      meta.createdAt = new Date().toISOString();
      meta.updatedAt = new Date().toISOString();
      await writeTextFile(metaPath, JSON.stringify(meta, null, 2));

      params.recentProjects.value.unshift({
        projectName: targetName,
        projectId: meta.id as string,
        updatedAt: meta.updatedAt as string,
        projectPath: targetPath,
      });

      await loadProjects();

      return;
    }

    if (!params.projectsHandle.value) return;
    if (params.projects.value.includes(targetName)) {
      params.error.value = `Project with name "${targetName}" already exists`;
      return;
    }

    const vfs = params.getVfs();
    const sourceVfsPath = toProjectStoragePath(sourceName);
    const targetVfsPath = toProjectStoragePath(targetName);

    await vfs.copyDirectory(sourceVfsPath, targetVfsPath);

    try {
      await vfs.deleteEntry(toProjectStoragePath(targetName, '.fastcat/backups'), true);
    } catch {
      // ignore if not present
    }
    try {
      await vfs.deleteEntry(toProjectStoragePath(targetName, '.fastcat/autosave'), true);
    } catch {
      // ignore if not present
    }

    const metaPath = toProjectStoragePath(targetName, '.fastcat/project.meta.json');
    let meta: Record<string, unknown> = {};
    try {
      const blob = await vfs.readFile(metaPath);
      const text = await blob.text();
      meta = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // fresh meta if missing
    }
    meta.id = genUuid();
    meta.createdAt = new Date().toISOString();
    meta.updatedAt = new Date().toISOString();
    await vfs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    params.recentProjects.value.unshift({
      projectName: targetName,
      projectId: meta.id as string,
      updatedAt: meta.updatedAt as string,
    });

    await loadProjects();
  }

  return {
    loadProjects,
    clearVardata,
    clearProjectVardata,
    deleteProject,
    forgetProject,
    renameProject,
    duplicateProject,
  };
}
