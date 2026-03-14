import type { VideoCoreHostAPI } from './worker-client';
import { ensureVectorImageRaster } from '~/media-cache/application/vectorImageCache';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';

export interface CreateVideoCoreHostApiParams {
  getCurrentProjectId: () => string | null;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getResolvedStorageTopology?: () => ResolvedStorageTopology | null;
  onExportProgress: (progress: number, taskId?: string) => void;
  onExportPhase?: (phase: 'encoding' | 'saving', taskId?: string) => void;
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
      const workspaceHandle = params.getWorkspaceHandle();
      if (!workspaceHandle) return null;
      return await ensureVectorImageRaster({
        projectId,
        projectRelativePath,
        width,
        height,
        sourceFileHandle,
        workspaceHandle,
        resolvedStorageTopology: params.getResolvedStorageTopology?.() ?? undefined,
      });
    },
    onExportProgress: (progress, taskId) => params.onExportProgress(progress, taskId),
    onExportPhase: params.onExportPhase,
    onExportWarning: params.onExportWarning,
  };
}
