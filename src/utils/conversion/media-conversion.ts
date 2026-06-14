import { createDevLogger } from '~/utils/dev-logger';
import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import {
  getExportWorkerClient,
  registerExportTaskHostApi,
  restartExportWorker,
  setExportHostApi,
  unregisterExportTaskHostApi,
} from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { getWorkspaceFileHandle } from '~/utils/workspace-fs';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { withFileIoSlot } from '~/utils/io/io-governor';
import type { ConversionRequest } from '~/types/conversion';
import { clampPositiveNumber, resolveAudioOnlyContainerFormat } from './helpers';
import {
  AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION,
  AUDIO_ONLY_EXPORT_PLACEHOLDER_FPS,
} from './constants';
import type { TranscodeOptions } from '~/composables/timeline/export/types';
const log = createDevLogger('media-conversion');

const METADATA_TIMEOUT_MS = 30000;

export async function executeMediaConversion(params: {
  request: ConversionRequest;
  targetHandle: FileSystemFileHandle;
  taskId: string;
  backgroundTaskId: string;
  isExternal: boolean;
  isCancelRequested: () => boolean;
  signal?: AbortSignal;
}) {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const backgroundTasksStore = useBackgroundTasksStore();

  async function getSourceFile(path: string): Promise<File | null> {
    if (params.isExternal) {
      const workspaceFileHandle = await getWorkspaceFileHandle(path);
      if (workspaceFileHandle) {
        try {
          return await withFileIoSlot(() => workspaceFileHandle.getFile());
        } catch {
          // Fall through to projectStore fallback below.
        }
      }
    }

    return await projectStore.getFileByPath(path);
  }

  return addMediaTask(
    async () => {
      const audioChannels =
        params.request.sharedAudio.channels === 1
          ? 'mono'
          : params.request.sharedAudio.channels === 2
            ? 'stereo'
            : undefined;

      const task = backgroundTasksStore.tasks.find((t) => t.id === params.backgroundTaskId);
      if (task?.status === 'cancelled' || params.isCancelRequested() || params.signal?.aborted) {
        const err = new Error('Cancelled');
        err.name = 'AbortError';
        throw err;
      }
      backgroundTasksStore.updateTaskStatus(params.backgroundTaskId, 'running');

      const { client } = getExportWorkerClient();

      setExportHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => projectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path) =>
            params.isExternal
              ? ((await getWorkspaceFileHandle(path)) ?? projectStore.getFileHandleByPath(path))
              : projectStore.getFileHandleByPath(path),
          getFileByPath: async (path) => await getSourceFile(path),
          onExportProgress: () => {},
        }),
      );
      registerExportTaskHostApi(params.taskId, {
        onExportProgress: (progress) => {
          const normalizedProgress = progress / 100;
          backgroundTasksStore.updateTaskProgress(params.backgroundTaskId, normalizedProgress);
        },
        onExportPhase: (phase) => {
          if (phase === 'finalizing') {
            backgroundTasksStore.updateTaskProgress(params.backgroundTaskId, 0.99);
          }
        },
        onExportWarning: (message) => {
          log.warn(message);
        },
      });

      try {
        const sourceFile = await getSourceFile(params.request.entry.path);
        if (!sourceFile) throw new Error('Failed to access source file');

        let metadataTimeoutId: number | undefined;
        const meta = await Promise.race([
          client.extractMetadata(sourceFile),
          new Promise<never>((_, reject) => {
            metadataTimeoutId = window.setTimeout(() => {
              restartExportWorker();
              reject(new Error('Metadata extraction timed out'));
            }, METADATA_TIMEOUT_MS);
          }),
        ]).finally(() => {
          if (metadataTimeoutId !== undefined) {
            window.clearTimeout(metadataTimeoutId);
          }
        });
        const durationUs = Math.round((meta.duration || 0) * 1_000_000);
        if (!durationUs && params.request.type === 'video') {
          throw new Error('Invalid media duration');
        }

        let exportOptions: TranscodeOptions = {} as TranscodeOptions;

        if (params.request.type === 'video' && params.request.video) {
          exportOptions = {
            format: params.request.video.format,
            videoCodec: params.request.video.videoCodec,
            bitrate: params.request.video.bitrateMbps * 1_000_000,
            audioBitrate: params.request.video.audioBitrateKbps * 1000,
            audio: !params.request.video.excludeAudio,
            audioCodec:
              params.request.video.format === 'mp4' ? 'aac' : params.request.video.audioCodec,
            width: Math.max(1, params.request.video.width ?? meta.video?.width ?? 1920),
            height: Math.max(1, params.request.video.height ?? meta.video?.height ?? 1080),
            fps: clampPositiveNumber(params.request.video.fps ?? Number(meta.video?.fps), 30),
            bitrateMode: params.request.video.bitrateMode,
            keyframeIntervalSec: params.request.video.keyframeIntervalSec,
            exportAlpha: false,
            audioChannels,
            audioSampleRate: params.request.sharedAudio.sampleRate || undefined,
          };
        } else if (params.request.audioOnly) {
          exportOptions = {
            format: resolveAudioOnlyContainerFormat(params.request.audioOnly.codec),
            videoCodec: 'none',
            bitrate: 100_000,
            audioBitrate: params.request.audioOnly.bitrateKbps * 1000,
            audio: true,
            audioCodec: params.request.audioOnly.codec,
            width: AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION,
            height: AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION,
            fps: AUDIO_ONLY_EXPORT_PLACEHOLDER_FPS,
            audioChannels,
            audioSampleRate: params.request.sharedAudio.sampleRate || undefined,
            audioReverse: params.request.audioOnly.reverse,
            audioDurationSec: meta.duration || undefined,
          };
        }

        await client.transcodeMedia(sourceFile, params.targetHandle, exportOptions, params.taskId);
      } finally {
        unregisterExportTaskHostApi(params.taskId);
      }
    },
    {
      priority: MEDIA_TASK_PRIORITIES.conversionBackground,
      signal: params.signal,
    },
  );
}
