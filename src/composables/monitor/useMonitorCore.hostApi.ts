import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';

export function createMonitorPreviewHostApi(params: {
  currentProjectId: string | null;
  workspaceHandle: FileSystemDirectoryHandle | null;
  resolvedStorageTopology: ResolvedStorageTopology | null;
  useProxyInMonitor: boolean;
  getProxyFileHandle: (path: string) => Promise<FileSystemFileHandle | null>;
  getProxyFile: (path: string) => Promise<File | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
}) {
  return createVideoCoreHostApi({
    getCurrentProjectId: () => params.currentProjectId,
    getWorkspaceHandle: () => params.workspaceHandle,
    getResolvedStorageTopology: () => params.resolvedStorageTopology,
    getFileHandleByPath: async (path) => {
      if (params.useProxyInMonitor) {
        const proxyHandle = await params.getProxyFileHandle(path);
        if (proxyHandle) {
          return proxyHandle;
        }
      }

      return await params.getFileHandleByPath(path);
    },
    getFileByPath: async (path) => {
      if (params.useProxyInMonitor) {
        const proxyFile = await params.getProxyFile(path);
        if (proxyFile) {
          return proxyFile;
        }
      }

      return await params.getFileByPath(path);
    },
    onExportProgress: () => {},
  });
}
