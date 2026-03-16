import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import { addLatestMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { useUiStore } from '~/stores/ui.store';

export interface GenerateTimelineThumbnailParams {
  projectId: string;
  timelinePath: string;
  timeUs: number;
  clipsPayload: any[];
  workspaceHandle: FileSystemDirectoryHandle;
  resolvedStorageTopology: any;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath: (path: string) => Promise<File | null>;
  width?: number;
  height?: number;
  quality?: number;
  notifyUi?: boolean;
}

export function dispatchTimelineThumbnailGeneration(params: GenerateTimelineThumbnailParams): void {
  addLatestMediaTask({
    key: `timeline-thumbnail:${params.timelinePath}`,
    task: async () => {
      try {
        const width = params.width ?? Math.max(160, Math.round(TIMELINE_CLIP_THUMBNAILS.WIDTH));
        const height = params.height ?? Math.max(90, Math.round(TIMELINE_CLIP_THUMBNAILS.HEIGHT));
        const quality = params.quality ?? 0.8;

        const { client } = getThumbnailWorkerClient();
        setThumbnailHostApi(
          createVideoCoreHostApi({
            getCurrentProjectId: () => params.projectId,
            getWorkspaceHandle: () => params.workspaceHandle,
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

        await fileThumbnailGenerator.saveManualThumbnail({
          projectId: params.projectId,
          projectRelativePath: params.timelinePath,
          blob,
        });

        if (params.notifyUi) {
          const uiStore = useUiStore();
          uiStore.notifyFileManagerUpdate();
        }
      } catch (error) {
        console.error('Failed to generate background timeline thumbnail:', error);
      }
    },
    priority: MEDIA_TASK_PRIORITIES.timelineThumbnailLazy,
  });
}
