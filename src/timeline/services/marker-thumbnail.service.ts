import { createDevLogger } from '~/utils/dev-logger';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { MARKER_THUMBNAILS } from '~/utils/constants';
import { addLatestMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { isTauriRuntime } from '~/utils/runtime';
import { nativeRenderTimelineFrameWebp } from '~/utils/tauri-media-processing';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import type { WorkerVideoPayloadItem } from '~/composables/timeline/export/types';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';
import type { NativeMonitorScene } from '~/timeline/timeline-thumbnail';
const log = createDevLogger('marker-thumbnail.service');

export interface MarkerThumbnailParams {
  projectId: string;
  markerId: string;
  timeUs: number;
  clipsPayload?: WorkerVideoPayloadItem[];
  nativeScene?: NativeMonitorScene;
  workspaceHandle?: DirectoryHandleLike | null;
  resolvedStorageTopology: ResolvedStorageTopology;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  onComplete?: (url: string) => void;
  onError?: (err: Error) => void;
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

        let blob: Blob | null = null;
        if (isTauriRuntime() && params.nativeScene && params.nativeScene.layers.length > 0) {
          blob = await nativeRenderTimelineFrameWebp({
            scene: params.nativeScene,
            timeSec: params.timeUs / 1_000_000,
            width,
            height,
            quality,
          });
        } else {
          const clipsPayload = params.clipsPayload;
          if (!clipsPayload?.length) {
            params.onError?.(new Error('No clips payload available'));
            return;
          }

          const [{ getThumbnailWorkerClient, setThumbnailHostApi }, { createVideoCoreHostApi }] =
            await Promise.all([
              import('~/utils/video-editor/worker-client'),
              import('~/utils/video-editor/createVideoCoreHostApi'),
            ]);
          const { client } = getThumbnailWorkerClient();
          if (!params.workspaceHandle) {
            params.onError?.(new Error('Workspace handle is required for web marker thumbnails'));
            return;
          }
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

          blob = await client.extractFrameToBlob(
            params.timeUs,
            width,
            height,
            clipsPayload,
            quality,
          );
        }

        if (!blob) {
          params.onError?.(new Error('Extracted blob is null'));
          return;
        }

        await fileThumbnailGenerator.saveMarkerThumbnail({
          projectId: params.projectId,
          markerId: params.markerId,
          timeUs: params.timeUs,
          blob,
        });

        const url = URL.createObjectURL(blob);
        params.onComplete?.(url);
      } catch (error) {
        log.error('Failed to generate marker thumbnail:', params.markerId, error);
        params.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    priority: MEDIA_TASK_PRIORITIES.timelineThumbnailLazy,
  });
}
