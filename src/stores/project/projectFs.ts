import type { Ref } from 'vue';
import {
  isWorkspaceCommonPath,
  normalizeWorkspaceFilePath,
  stripWorkspaceCommonPathPrefix,
  WORKSPACE_COMMON_DIR_NAME,
} from '~/utils/workspace-common';

export interface ProjectFsModule {
  toProjectRelativePath: (path: string) => string;
  getProjectFileHandleByRelativePath: (input: {
    relativePath: string;
    create?: boolean;
  }) => Promise<FileSystemFileHandle | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
}

export function createProjectFsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectName: Ref<string | null>;
}) {
  function toProjectRelativePath(path: string): string {
    return normalizeWorkspaceFilePath(path);
  }

  async function getWorkspaceCommonDirHandle(
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    if (!params.workspaceHandle.value) return null;

    try {
      return await params.workspaceHandle.value.getDirectoryHandle(WORKSPACE_COMMON_DIR_NAME, {
        create,
      });
    } catch {
      return null;
    }
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

      const parts = commonRelativePath.split('/');
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
          console.error('Failed to get common file handle by path:', input.relativePath, e);
        }
        return null;
      }
    }

    if (!params.projectsHandle.value || !params.currentProjectName.value) return null;

    const parts = normalizedPath.split('/');
    const fileName = parts.pop();
    if (!fileName) return null;

    try {
      const projectDir = await params.projectsHandle.value.getDirectoryHandle(
        params.currentProjectName.value,
      );
      let currentDir = projectDir;
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
        console.error('Failed to get project file handle by path:', input.relativePath, e);
      }
      return null;
    }
  }

  async function getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null> {
    return await getProjectFileHandleByRelativePath({ relativePath: path, create: false });
  }

  async function getProjectDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!params.projectsHandle.value || !params.currentProjectName.value) return null;
    try {
      return await params.projectsHandle.value.getDirectoryHandle(params.currentProjectName.value);
    } catch {
      return null;
    }
  }

  const module: ProjectFsModule = {
    toProjectRelativePath,
    getProjectFileHandleByRelativePath,
    getFileHandleByPath,
    getProjectDirHandle,
  };

  return module;
}
