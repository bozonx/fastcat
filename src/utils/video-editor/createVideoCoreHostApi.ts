import type { VideoCoreHostAPI } from './worker-client';
import { ensureVectorImageRaster } from '~/media-cache/application/vectorImageCache';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { useVfs } from '~/composables/useVfs';

export interface CreateVideoCoreHostApiParams {
  getCurrentProjectId: () => string | null;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
  getVfs?: () => IFileSystemAdapter | null;
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getResolvedStorageTopology?: () => ResolvedStorageTopology | null;
  onExportProgress: (progress: number, taskId?: string) => void;
  onExportPhase?: (phase: 'encoding' | 'finalizing', taskId?: string) => void;
  onExportWarning?: (message: string, taskId?: string) => void;
}

export function createVideoCoreHostApi(params: CreateVideoCoreHostApiParams): VideoCoreHostAPI {
  const getFileByPath = params.getFileByPath;

  return {
    getCurrentProjectId: async () => params.getCurrentProjectId(),
    getFileHandleByPath: async (path) => await params.getFileHandleByPath(path),
    ...(getFileByPath
      ? {
          getFileByPath: async (path: string) => await getFileByPath(path),
        }
      : {}),
    ensureVectorImageRaster: async ({
      projectId,
      projectRelativePath,
      width,
      height,
      sourceFileHandle,
    }) => {
      const vfs = params.getVfs?.() ?? useVfs();
      if (!vfs || !params.getWorkspaceHandle()) return null;
      return await ensureVectorImageRaster({
        projectId,
        projectRelativePath,
        width,
        height,
        sourceFileHandle,
        vfs,
      });
    },
    onExportProgress: (progress, taskId) => params.onExportProgress(progress, taskId),
    onExportPhase: params.onExportPhase,
    onExportWarning: params.onExportWarning,
  };
}
