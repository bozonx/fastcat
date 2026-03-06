import type { VideoCoreHostAPI } from './worker-client';
import { ensureVectorImageRaster } from '~/media-cache/application/vectorImageCache';

export interface CreateVideoCoreHostApiParams {
  getCurrentProjectId: () => string | null;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  onExportProgress: (progress: number) => void;
  onExportPhase?: (phase: 'encoding' | 'saving') => void;
  onExportWarning?: (message: string) => void;
}

export function createVideoCoreHostApi(
  params: CreateVideoCoreHostApiParams,
): VideoCoreHostAPI {
  return {
    getCurrentProjectId: async () => params.getCurrentProjectId(),
    getFileHandleByPath: async (path) => await params.getFileHandleByPath(path),
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
      });
    },
    onExportProgress: (progress) => params.onExportProgress(progress),
    onExportPhase: params.onExportPhase,
    onExportWarning: params.onExportWarning,
  };
}
