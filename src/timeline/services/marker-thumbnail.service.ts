import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { MARKER_THUMBNAILS } from '~/utils/constants';
import { addLatestMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import type { WorkerVideoPayloadItem } from '~/composables/timeline/export/types';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';

export interface MarkerThumbnailParams {
  projectId: string;
  markerId: string;
  timeUs: number;
  clipsPayload: WorkerVideoPayloadItem[];
  workspaceHandle: DirectoryHandleLike;
  resolvedStorageTopology: ResolvedStorageTopology;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  onComplete?: (url: string) => void;
}

/**
 * Dispatches marker thumbnail generation to the media task queue.
 */
export function dispatchMarkerThumbnailGeneration(params: MarkerThumbnailParams): void {
  addLatestMediaTask({
    key: `marker-thumbnail:${params.markerId}`,
    task: async () => {
      try {
        const width = MARKER_THUMBNAILS.WIDTH;
        const height = MARKER_THUMBNAILS.HEIGHT;
        const quality = MARKER_THUMBNAILS.QUALITY;

        const { client } = getThumbnailWorkerClient();
        setThumbnailHostApi(
          createVideoCoreHostApi({
            getCurrentProjectId: () => params.projectId,
            getWorkspaceHandle: () => params.workspaceHandle as FileSystemDirectoryHandle,
            getResolvedStorageTopology: () => params.resolvedStorageTopology,
            getFileHandleByPath: params.getFileHandleByPath,
            getFileByPath: params.getFileByPath,
            onExportProgress: () => {},
          }),
        );

        const blob = await client.extractFrameToBlob(
          params.timeUs,
          width,
          height,
          params.clipsPayload,
          quality,
        );

        if (!blob) return;

        await fileThumbnailGenerator.saveMarkerThumbnail({
          projectId: params.projectId,
          markerId: params.markerId,
          timeUs: params.timeUs,
          blob,
        });

        const url = URL.createObjectURL(blob);
        params.onComplete?.(url);
      } catch (error) {
        console.error('Failed to generate marker thumbnail:', params.markerId, error);
      }
    },
    priority: MEDIA_TASK_PRIORITIES.timelineThumbnailLazy,
  });
}
