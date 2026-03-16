import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { EXPORT_DIR_NAME } from '~/utils/constants';

export function useExportFileSystem() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  let cachedExportDir: FileSystemDirectoryHandle | null = null;
  let cachedProjectName: string | null = null;
  let cachedProjectsHandle: FileSystemDirectoryHandle | null = null;

  function resetExportFsCache() {
    cachedExportDir = null;
    cachedProjectName = null;
    cachedProjectsHandle = null;
  }

  function isExportDirCacheValid() {
    return (
      cachedExportDir !== null &&
      cachedProjectsHandle === workspaceStore.projectsHandle &&
      cachedProjectName === projectStore.currentProjectName
    );
  }

  async function ensureExportDir(): Promise<FileSystemDirectoryHandle> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
      resetExportFsCache();
      throw new Error('Project is not opened');
    }

    if (isExportDirCacheValid() && cachedExportDir) {
      return cachedExportDir;
    }

    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
      projectStore.currentProjectName,
    );
    cachedExportDir = await projectDir.getDirectoryHandle(EXPORT_DIR_NAME, { create: true });
    cachedProjectName = projectStore.currentProjectName;
    cachedProjectsHandle = workspaceStore.projectsHandle;
    return cachedExportDir;
  }

  async function listExportFilenames(exportDir: FileSystemDirectoryHandle): Promise<Set<string>> {
    const names = new Set<string>();
    const iterator = (exportDir as any).values?.() ?? (exportDir as any).entries?.();
    if (!iterator) return names;

    for await (const value of iterator) {
      const handle = Array.isArray(value) ? value[1] : value;
      if (handle?.kind === 'file' && typeof handle?.name === 'string') {
        names.add(handle.name);
      }
    }
    return names;
  }

  return {
    ensureExportDir,
    listExportFilenames,
  };
}
