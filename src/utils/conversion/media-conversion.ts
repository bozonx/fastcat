import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import {
  getExportWorkerClient,
  registerExportTaskHostApi,
  restartExportWorker,
  setExportHostApi,
  unregisterExportTaskHostApi,
} from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import type { ConversionRequest } from '~/types/conversion';
import { clampPositiveNumber, resolveAudioOnlyContainerFormat } from './helpers';
import {
  AUDIO_ONLY_EXPORT_PLACEHOLDER_DIMENSION,
  AUDIO_ONLY_EXPORT_PLACEHOLDER_FPS,
} from './constants';
import type { ExportOptions } from '~/composables/timeline/export/types';

const METADATA_TIMEOUT_MS = 15000;

export async function executeMediaConversion(params: {
  request: ConversionRequest;
  targetHandle: FileSystemFileHandle;
  taskId: string;
  backgroundTaskId: string;
  isCancelRequested: () => boolean;
}) {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const backgroundTasksStore = useBackgroundTasksStore();

  return addMediaTask(
    async () => {
      const task = backgroundTasksStore.tasks.find((t) => t.id === params.backgroundTaskId);
      if (task?.status === 'cancelled' || params.isCancelRequested()) {
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
          getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
          getFileByPath: async (path) => projectStore.getFileByPath(path),
          onExportProgress: () => {},
        }),
      );
      registerExportTaskHostApi(params.taskId, {
        onExportProgress: (progress) => {
          const normalizedProgress = progress / 100;
          backgroundTasksStore.updateTaskProgress(params.backgroundTaskId, normalizedProgress);
        },
        onExportPhase: (phase) => {
          // You could also emit phase events via store/callbacks if needed
        },
        onExportWarning: (message) => {
          console.warn(message);
        },
      });

      try {
        const sourceFile = await projectStore.getFileByPath(params.request.entry.path);
        if (!sourceFile) throw new Error('Failed to access source file');

        const meta = await Promise.race([
          client.extractMetadata(sourceFile),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              restartExportWorker();
              reject(new Error('Metadata extraction timed out'));
            }, METADATA_TIMEOUT_MS);
          }),
        ]);
        const durationUs = Math.round((meta.duration || 0) * 1_000_000);
        if (!durationUs && params.request.type === 'video') {
          throw new Error('Invalid media duration');
        }

        let exportOptions: ExportOptions = {} as ExportOptions;

        if (params.request.type === 'video' && params.request.video) {
          exportOptions = {
            format: params.request.video.format,
            videoCodec: params.request.video.videoCodec,
            bitrate: params.request.video.bitrateMbps * 1_000_000,
            audioBitrate: params.request.video.audioBitrateKbps * 1000,
            audio: !params.request.video.excludeAudio,
            audioCodec:
              params.request.video.format === 'mp4' ? 'aac' : params.request.video.audioCodec,
            width: Math.max(1, params.request.video.width || meta.video?.width || 1920),
            height: Math.max(1, params.request.video.height || meta.video?.height || 1080),
            fps: clampPositiveNumber(params.request.video.fps || Number(meta.video?.fps), 30),
            bitrateMode: params.request.video.bitrateMode,
            keyframeIntervalSec: params.request.video.keyframeIntervalSec,
            exportAlpha: false,
            audioChannels: params.request.sharedAudio.channels,
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
            audioChannels: params.request.sharedAudio.channels,
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
    },
  );
}
