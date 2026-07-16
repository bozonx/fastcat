import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { buildVideoWorkerPayloadFromTracks } from '~/timeline/application/workerPayloadBuilder';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
import { createProjectHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import {
  getThumbnailWorkerClient,
  runWithThumbnailHostApi,
} from '~/utils/video-editor/worker-client';
import { fitDimensions } from './media-processor.utils';
import type {
  ExtractTimelineFrameBlobOptions,
  ExtractVideoFrameBlobOptions,
  ExtractVideoFrameBlobsOptions,
  IMediaProcessor,
} from './media-processor.types';

export function createWebMediaProcessor(): IMediaProcessor {
  const activeExtractorTaskIds = new Set<string>();

  return {
    id: 'web',

    async extractVideoFrameBlob(options: ExtractVideoFrameBlobOptions): Promise<Blob | null> {
      const projectStore = useProjectStore();
      const file = await projectStore.getFileByPath(options.projectRelativePath);
      if (!file) {
        throw new Error(`Source file not found: ${options.projectRelativePath}`);
      }

      let timeSec = options.timeSec;
      if (timeSec === undefined) {
        if (options.positionFraction !== undefined) {
          const duration = await probeVideoDuration(file);
          timeSec = Math.max(0, duration * options.positionFraction);
        } else {
          timeSec = 0;
        }
      }

      const blobs = await runWithThumbnailHostApi(createProjectHostApi(), async () => {
        const { client } = getThumbnailWorkerClient();
        return await client.extractVideoFrameBlobs(file, {
          timesS: [timeSec],
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
          quality: options.quality,
          mimeType: 'image/webp',
          taskId: `video-frame:${options.projectRelativePath}`,
          keepAlive: false,
        });
      });
      return blobs[0] ?? null;
    },

    async extractVideoFrameBlobs(options: ExtractVideoFrameBlobsOptions): Promise<(Blob | null)[]> {
      const projectStore = useProjectStore();
      const file = await projectStore.getFileByPath(options.projectRelativePath);
      if (!file) {
        throw new Error(`Source file not found: ${options.projectRelativePath}`);
      }

      if (options.taskId) {
        activeExtractorTaskIds.add(options.taskId);
      }

      return await runWithThumbnailHostApi(createProjectHostApi(), async () => {
        const { client } = getThumbnailWorkerClient();
        return await client.extractVideoFrameBlobs(file, {
          timesS: options.timesSec,
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
          quality: options.quality,
          mimeType: options.mimeType ?? 'image/webp',
          taskId: options.taskId,
          keepAlive: options.keepAlive ?? false,
        });
      });
    },

    async extractTimelineFrameBlob(options: ExtractTimelineFrameBlobOptions): Promise<Blob | null> {
      const projectStore = useProjectStore();
      const workspaceStore = useWorkspaceStore();
      if (!workspaceStore.workspaceHandle) {
        throw new Error('Workspace is not opened');
      }

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: options.timelineDoc.tracks,
        projectStore,
        workspaceStore,
      });
      const clipsPayload = builtVideo.payload;
      if (clipsPayload.length === 0) return null;

      const format = resolveEffectiveTimelineFormat(
        getTimelineFormat(options.timelineDoc),
        projectStore.projectSettings.project,
      );
      const { width, height } = resolveTimelineFrameDimensions(format, options);

      return await runWithThumbnailHostApi(createProjectHostApi(), async () => {
        const { client } = getThumbnailWorkerClient();
        return await client.extractFrameToBlob(
          options.timeTicks,
          width,
          height,
          clipsPayload,
          options.quality ?? 0.8,
          options.isTransparent,
          options.effectQuality,
        );
      });
    },

    async cancelVideoFrameExtraction(taskId: string): Promise<void> {
      const { client } = getThumbnailWorkerClient();
      try {
        await client.cancelExport(taskId);
      } catch {
        // ignore
      }
    },

    async releaseVideoFrameExtractor(taskId: string): Promise<void> {
      if (!activeExtractorTaskIds.has(taskId)) return;
      activeExtractorTaskIds.delete(taskId);
      const { client } = getThumbnailWorkerClient();
      try {
        await client.releaseFrameExtractor(taskId);
      } catch {
        // ignore
      }
    },

    async dispose() {
      const { client } = getThumbnailWorkerClient();
      for (const taskId of activeExtractorTaskIds) {
        try {
          await client.releaseFrameExtractor(taskId);
        } catch {
          // ignore
        }
      }
      activeExtractorTaskIds.clear();
    },
  };
}

function resolveTimelineFrameDimensions(
  format: { width: number; height: number },
  options: ExtractTimelineFrameBlobOptions,
): { width: number; height: number } {
  if (options.width && options.height) {
    return { width: options.width, height: options.height };
  }

  const maxWidth = options.maxWidth ?? 1280;
  const maxHeight = options.maxHeight ?? 1280;
  return fitDimensions(format.width, format.height, maxWidth, maxHeight);
}

function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.onloadedmetadata = null;
      video.onerror = null;
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video metadata timeout'));
    }, 5000);

    video.onloadedmetadata = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(video.duration);
    };
    video.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };
  });
}
