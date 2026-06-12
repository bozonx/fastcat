import { ref, computed, reactive, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useUiStore } from '~/stores/ui.store';
import { getExportWorkerClient } from '~/utils/video-editor/worker-client';
import { getWorkspaceFileHandle } from '~/utils/workspace-fs';
import { isTauriRuntime } from '~/utils/runtime';
import type { ConversionRequest } from '~/types/conversion';
import {
  clampPositiveNumber,
  createConversionTaskId,
  isAbortError,
  removeCreatedFile,
  resolveAudioOnlyFileExtension,
} from '~/utils/conversion/helpers';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { convertImageFile } from '~/utils/conversion/image-conversion';
import {
  getNativeFileHandlePath,
  nativeCancelMediaTask,
  nativeConvertMedia,
} from '~/utils/tauri-media-processing';
import {
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_CODEC,
  DEFAULT_VIDEO_BITRATE_MBPS,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_AUDIO_BITRATE_KBPS,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_VIDEO_FPS,
  DEFAULT_IMAGE_QUALITY,
} from '~/utils/conversion/constants';
import { createGroupedWarningReporter } from '~/utils/grouped-warnings';

export type BatchConversionType = 'video' | 'audio' | 'image';

interface BatchConversionState {
  isModalOpen: boolean;
  isConverting: boolean;
  conversionError: string;
  conversionWarnings: string[];
  entries: FsEntry[];
  conversionType: BatchConversionType | null;
  targetIsExternal: boolean;
}

const state = reactive<BatchConversionState>({
  isModalOpen: false,
  isConverting: false,
  conversionError: '',
  conversionWarnings: [],
  entries: [],
  conversionType: null,
  targetIsExternal: false,
});

const videoSettings = reactive({
  format: DEFAULT_VIDEO_FORMAT as 'mp4' | 'webm' | 'mkv',
  videoCodec: DEFAULT_VIDEO_CODEC,
  bitrateMbps: DEFAULT_VIDEO_BITRATE_MBPS,
  excludeAudio: false,
  audioCodec: DEFAULT_AUDIO_CODEC as 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3',
  audioBitrateKbps: DEFAULT_AUDIO_BITRATE_KBPS,
  bitrateMode: 'variable' as 'constant' | 'variable',
  keyframeIntervalSec: 2,
  width: DEFAULT_VIDEO_WIDTH,
  height: DEFAULT_VIDEO_HEIGHT,
  fps: DEFAULT_VIDEO_FPS,
  resolutionFormat: '1080p',
  orientation: 'landscape' as 'landscape' | 'portrait',
  aspectRatio: '16:9',
  isCustomResolution: false,
});

const audioSettings = reactive({
  onlyFormat: 'opus' as 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3',
  onlyBitrateKbps: DEFAULT_AUDIO_BITRATE_KBPS,
  channels: 2,
  sampleRate: 'original' as 'original' | number,
  reverse: false,
  originalSampleRate: null as number | null,
  originalChannels: null as number | null,
});

const imageSettings = reactive({
  quality: DEFAULT_IMAGE_QUALITY,
  width: 0,
  height: 0,
  isResolutionLinked: true,
  aspectRatio: 1,
});

export function useBatchConversion() {
  const projectStore = useProjectStore();
  const fileManager = useFileManager();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const { t } = useI18n();
  const toast = useToast();

  const modalTitle = computed(() => {
    if (state.conversionType === 'image') {
      return t('videoEditor.fileManager.convert.convertToWebp');
    }
    return t('videoEditor.export.convertFile');
  });

  function getSiblingTarget(entryPath: string, fileName: string): { dirPath: string; filePath: string } {
    const separatorIndex = entryPath.lastIndexOf('/');
    if (separatorIndex < 0) {
      return { dirPath: '', filePath: fileName };
    }
    if (separatorIndex === 0) {
      return { dirPath: '/', filePath: `/${fileName}` };
    }
    const dirPath = entryPath.slice(0, separatorIndex);
    return { dirPath, filePath: `${dirPath}/${fileName}` };
  }

  function buildConversionRequest(entry: FsEntry, type: BatchConversionType): ConversionRequest {
    const baseName = entry.name.replace(/\.[^.]+$/, '');
    let newExt = '';
    if (type === 'image') newExt = 'webp';
    else if (type === 'audio') {
      newExt = resolveAudioOnlyFileExtension(audioSettings.onlyFormat);
    } else newExt = videoSettings.format;

    const sampleRate =
      audioSettings.sampleRate === 'original'
        ? audioSettings.originalSampleRate
        : clampPositiveNumber(Number(audioSettings.sampleRate), 0);

    const target = getSiblingTarget(entry.path!, `${baseName}_converted.${newExt}`);

    const request: ConversionRequest = {
      entry,
      type,
      dirPath: target.dirPath,
      newFileName: `${baseName}_converted.${newExt}`,
      sharedAudio: {
        channels: audioSettings.channels,
        sampleRate: sampleRate && sampleRate > 0 ? sampleRate : null,
      },
    };

    if (type === 'video') {
      request.video = {
        format: videoSettings.format,
        videoCodec: videoSettings.videoCodec,
        bitrateMbps: clampPositiveNumber(videoSettings.bitrateMbps, 5),
        excludeAudio: videoSettings.excludeAudio,
        audioCodec: videoSettings.audioCodec,
        audioBitrateKbps: clampPositiveNumber(videoSettings.audioBitrateKbps, 128),
        bitrateMode: videoSettings.bitrateMode,
        keyframeIntervalSec: clampPositiveNumber(videoSettings.keyframeIntervalSec, 2),
        width: null,
        height: null,
        fps: null,
      };
    } else if (type === 'audio') {
      request.audioOnly = {
        codec: audioSettings.onlyFormat,
        bitrateKbps: clampPositiveNumber(audioSettings.onlyBitrateKbps, 128),
        reverse: audioSettings.reverse,
      };
    } else {
      request.image = {
        quality: Math.max(1, Math.min(100, Math.round(Number(imageSettings.quality) || DEFAULT_IMAGE_QUALITY))),
        width: Math.max(1, Math.round(Number(imageSettings.width) || 1)),
        height: Math.max(1, Math.round(Number(imageSettings.height) || 1)),
      };
    }

    return request;
  }

  async function convertSingleEntry(
    entry: FsEntry,
    type: BatchConversionType,
    taskId: string,
    bgTaskId: string,
    reportWarning: (message: string) => void,
    isCancelRequested: () => boolean,
  ): Promise<void> {
    const request = buildConversionRequest(entry, type);
    const target = getSiblingTarget(entry.path!, request.newFileName);
    const dirPath = request.dirPath;

    if (type === 'video' || type === 'audio') {
      const targetHandle = state.targetIsExternal
        ? await getWorkspaceFileHandle(target.filePath, { create: true })
        : await (async () => {
            const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
            if (!dirHandle) return null;
            return await dirHandle.getFileHandle(request.newFileName, { create: true });
          })();
      if (!targetHandle) throw new Error('Target directory not found');

      const controller = new AbortController();

      if (isTauriRuntime()) {
        const sourceHandle = state.targetIsExternal
          ? await getWorkspaceFileHandle(entry.path!)
          : await projectStore.getFileHandleByPath(entry.path!);
        const sourcePath = getNativeFileHandlePath(sourceHandle);
        const targetPath = getNativeFileHandlePath(targetHandle);
        if (!sourcePath || !targetPath) {
          throw new Error('Could not resolve native file paths for conversion');
        }
        await nativeConvertMedia({
          taskId,
          sourcePath,
          targetPath,
          request,
          onWarning: reportWarning,
          onProgress: () => {},
        });
        return;
      }

      await executeMediaConversion({
        request,
        targetHandle,
        taskId,
        backgroundTaskId: bgTaskId,
        isExternal: state.targetIsExternal,
        signal: controller.signal,
        isCancelRequested,
      });
    } else if (type === 'image') {
      let sourceFile: File | null = null;
      try {
        sourceFile = await fileManager.vfs.getFile(entry.path!);
      } catch {
        sourceFile = await projectStore.getFileByPath(entry.path!);
      }
      if (!sourceFile) throw new Error('Failed to access source file');

      const blob = await convertImageFile({
        file: sourceFile,
        request,
        isCancelRequested,
      });
      await fileManager.vfs.writeFile(target.filePath, blob);
    }
  }

  async function openModal(type: BatchConversionType, entries: FsEntry[], isExternal: boolean) {
    state.conversionType = type;
    state.entries = entries.filter(
      (e) => e.kind === 'file' && e.path && getMediaTypeFromFilename(e.name) === type,
    );
    state.targetIsExternal = isExternal;
    state.isConverting = false;
    state.conversionError = '';
    state.conversionWarnings = [];
    state.isModalOpen = true;
  }

  async function startConversion() {
    if (!state.conversionType || state.entries.length === 0) return;
    if (state.isConverting) return;

    state.conversionError = '';
    state.conversionWarnings = [];
    const conversionWarningsRef = ref<string[]>(state.conversionWarnings);
    const reportWarning = createGroupedWarningReporter(conversionWarningsRef);

    const type = state.conversionType;
    const entries = [...state.entries];
    const title = t('videoEditor.fileManager.batchConvert.taskTitle', { count: entries.length });

    const controller = new AbortController();
    const bgTaskId = backgroundTasksStore.addTask({
      type: 'conversion',
      title,
      status: 'pending',
      cancel: async () => {
        controller.abort();
        if (isTauriRuntime()) {
          for (const entry of entries) {
            const taskId = createConversionTaskId();
            await nativeCancelMediaTask(taskId).catch(() => {});
          }
        } else {
          const { client } = getExportWorkerClient();
          await client.cancelExport('batch-conversion').catch(() => {});
        }
      },
    });

    state.isConverting = true;
    state.isModalOpen = false;

    const runBatch = async () => {
      const total = entries.length;
      let completed = 0;
      let lastDirPath = '';

      for (const entry of entries) {
        if (controller.signal.aborted) {
          const err = new Error('Cancelled');
          err.name = 'AbortError';
          throw err;
        }

        const taskId = createConversionTaskId();
        const isCancelRequested = () => {
          const task = backgroundTasksStore.tasks.find((t) => t.id === bgTaskId);
          return task?.status === 'cancelled' || controller.signal.aborted;
        };

        try {
          await convertSingleEntry(entry, type, taskId, bgTaskId, reportWarning, isCancelRequested);
          completed++;
          backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);
        } catch (err) {
          const request = buildConversionRequest(entry, type);
          const target = getSiblingTarget(entry.path!, request.newFileName);
          const dirHandle = state.targetIsExternal
            ? null
            : await projectStore.getDirectoryHandleByPath(request.dirPath);
          await removeCreatedFile({
            dirHandle,
            fileName: request.newFileName,
            filePath: target.filePath,
          });

          if (isAbortError(err)) throw err;
          reportWarning(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
          completed++;
          backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);
        }

        if (entry.path) {
          const dirPath = entry.path.split('/').slice(0, -1).join('/');
          lastDirPath = dirPath;
          await fileManager.reloadDirectory(dirPath);
        }
      }

      if (lastDirPath) {
        await fileManager.reloadDirectory(lastDirPath);
      }
      uiStore.notifyFileManagerUpdate();
    };

    runBatch()
      .then(() => {
        backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
        backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
        if (state.conversionWarnings.length > 0) {
          toast.add({
            title: t('videoEditor.fileManager.batchConvert.completedWithWarnings'),
            description: state.conversionWarnings[0],
            color: 'warning',
          });
        } else {
          toast.add({
            title: t('videoEditor.fileManager.batchConvert.success'),
            color: 'success',
          });
        }
      })
      .catch((err) => {
        if (isAbortError(err)) {
          backgroundTasksStore.updateTaskStatus(bgTaskId, 'cancelled');
        } else {
          backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', err.message);
          toast.add({
            title: t('videoEditor.fileManager.batchConvert.failed'),
            description: err instanceof Error ? err.message : String(err),
            color: 'error',
          });
        }
      })
      .finally(() => {
        state.isConverting = false;
        state.entries = [];
        state.conversionType = null;
      });
  }

  function cancelConversion() {
    state.isModalOpen = false;
    state.isConverting = false;
  }

  return {
    state,
    videoSettings,
    audioSettings,
    imageSettings,
    modalTitle,
    openModal,
    startConversion,
    cancelConversion,
  };
}
