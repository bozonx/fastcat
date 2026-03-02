import type { Ref } from 'vue';

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
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectName: Ref<string | null>;
}) {
  function toProjectRelativePath(path: string): string {
    return path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/');
  }

  async function getProjectFileHandleByRelativePath(input: {
    relativePath: string;
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!params.projectsHandle.value || !params.currentProjectName.value) return null;
    const normalizedPath = toProjectRelativePath(input.relativePath);
    if (!normalizedPath) return null;

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
