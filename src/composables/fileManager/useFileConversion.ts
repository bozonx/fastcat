import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import {
  getExportWorkerClient,
  registerExportTaskHostApi,
  setExportHostApi,
  unregisterExportTaskHostApi,
} from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useUiStore } from '~/stores/ui.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

// Module-level singleton state so all components share the same modal instance.
const isModalOpen = ref(false);
const targetEntry = ref<FsEntry | null>(null);

const mediaType = computed(() => {
  if (!targetEntry.value) return null;
  return getMediaTypeFromFilename(targetEntry.value.name);
});

const isConverting = ref(false);
const isCancelRequested = ref(false);
const activeForegroundConversionTaskId = ref<string | null>(null);
const conversionProgress = ref(0);
const conversionError = ref<string | null>(null);
const conversionPhase = ref<'encoding' | 'saving' | null>(null);

interface SharedAudioSettings {
  channels: 'stereo' | 'mono';
  sampleRate: number | null;
}

interface VideoConversionSettings {
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrateMbps: number;
  excludeAudio: boolean;
  audioCodec: 'aac' | 'opus';
  audioBitrateKbps: number;
  bitrateMode: 'constant' | 'variable';
  keyframeIntervalSec: number;
  width: number;
  height: number;
  fps: number;
}

interface AudioOnlyConversionSettings {
  codec: 'opus' | 'aac';
  bitrateKbps: number;
  reverse: boolean;
}

interface ImageConversionSettings {
  quality: number;
  width: number;
  height: number;
}

interface ConversionRequest {
  entry: FsEntry;
  type: 'video' | 'audio' | 'image';
  dirPath: string;
  newFileName: string;
  sharedAudio: SharedAudioSettings;
  video?: VideoConversionSettings;
  audioOnly?: AudioOnlyConversionSettings;
  image?: ImageConversionSettings;
}

// Video Settings
const videoFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4');
const videoCodec = ref('avc1.640032');
const videoBitrateMbps = ref(5);
const excludeAudio = ref(false);
const audioCodec = ref<'aac' | 'opus'>('aac');
const audioBitrateKbps = ref(128);
const bitrateMode = ref<'constant' | 'variable'>('variable');
const keyframeIntervalSec = ref(2);
const videoWidth = ref(1920);
const videoHeight = ref(1080);
const videoFps = ref(30);
const resolutionFormat = ref('1080p');
const orientation = ref<'landscape' | 'portrait'>('landscape');
const aspectRatio = ref('16:9');
const isCustomResolution = ref(false);

// Audio Settings
const audioOnlyFormat = ref<'opus' | 'aac'>('opus');
const audioOnlyCodec = ref<'opus' | 'aac'>('opus');
const audioOnlyBitrateKbps = ref(128);
const audioChannels = ref<'stereo' | 'mono'>('stereo');
const audioSampleRate = ref(0);
const audioReverse = ref(false);
const originalAudioSampleRate = ref<number | null>(null);

// Image Settings
const imageQuality = ref(80); // 0-100
const imageWidth = ref(0);
const imageHeight = ref(0);
const isImageResolutionLinked = ref(true);
const imageAspectRatio = ref(1);
const conversionModalRequestId = ref(0);

export function useFileConversion() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const toast = useToast();

  function resolveAudioChannelsFromMeta(channels?: number): 'stereo' | 'mono' {
    if (!channels) return 'stereo';
    if (channels === 1) return 'mono';
    return 'stereo';
  }

  function resolveAudioOnlyContainerFormat(codec: 'opus' | 'aac'): 'mkv' | 'mp4' {
    if (codec === 'opus') return 'mkv';
    return 'mp4';
  }

  function clampPositiveNumber(value: number, fallback: number) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return fallback;
    return v;
  }

  function createConversionTaskId() {
    return `file-conversion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function isAbortError(error: unknown) {
    return error instanceof Error && error.name === 'AbortError';
  }

  async function waitForFsSettling() {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async function removeCreatedFile(params: {
    dirHandle: FileSystemDirectoryHandle | null;
    fileName: string | null;
  }) {
    if (!params.dirHandle || !params.fileName) return;
    try {
      await waitForFsSettling();
      await params.dirHandle.removeEntry(params.fileName);
    } catch {
      // ignore
    }
  }

  function buildConversionRequest(entry: FsEntry): ConversionRequest {
    const type = mediaType.value;
    if (type !== 'video' && type !== 'audio' && type !== 'image') {
      throw new Error('Unsupported media type');
    }

    const baseName = entry.name.replace(/\.[^.]+$/, '');
    let newExt = '';
    if (type === 'image') newExt = 'webp';
    else if (type === 'audio') newExt = audioOnlyFormat.value;
    else newExt = videoFormat.value;

    const sampleRate =
      audioSampleRate.value === 0
        ? originalAudioSampleRate.value
        : clampPositiveNumber(Number(audioSampleRate.value), 0);

    const request: ConversionRequest = {
      entry,
      type,
      dirPath: entry.path.split('/').slice(0, -1).join('/'),
      newFileName: `${baseName}_converted.${newExt}`,
      sharedAudio: {
        channels: audioChannels.value,
        sampleRate: sampleRate && sampleRate > 0 ? sampleRate : null,
      },
    };

    if (type === 'video') {
      request.video = {
        format: videoFormat.value,
        videoCodec: videoCodec.value,
        bitrateMbps: clampPositiveNumber(videoBitrateMbps.value, 5),
        excludeAudio: excludeAudio.value,
        audioCodec: audioCodec.value,
        audioBitrateKbps: clampPositiveNumber(audioBitrateKbps.value, 128),
        bitrateMode: bitrateMode.value,
        keyframeIntervalSec: clampPositiveNumber(keyframeIntervalSec.value, 2),
        width: Math.max(1, Math.round(Number(videoWidth.value) || 1920)),
        height: Math.max(1, Math.round(Number(videoHeight.value) || 1080)),
        fps: clampPositiveNumber(Number(videoFps.value), 30),
      };
    } else if (type === 'audio') {
      request.audioOnly = {
        codec: audioOnlyCodec.value,
        bitrateKbps: clampPositiveNumber(audioOnlyBitrateKbps.value, 128),
        reverse: audioReverse.value,
      };
    } else {
      request.image = {
        quality: Math.max(1, Math.min(100, Math.round(Number(imageQuality.value) || 80))),
        width: Math.max(1, Math.round(Number(imageWidth.value) || 1)),
        height: Math.max(1, Math.round(Number(imageHeight.value) || 1)),
      };
    }

    return request;
  }

  async function openConversionModal(entry: FsEntry) {
    const requestId = conversionModalRequestId.value + 1;
    conversionModalRequestId.value = requestId;
    targetEntry.value = entry;
    const type = mediaType.value;

    isConverting.value = false;
    conversionProgress.value = 0;
    conversionError.value = null;
    conversionPhase.value = null;
    isModalOpen.value = true;

    if (type === 'video') {
      videoFormat.value = projectStore.projectSettings?.exportDefaults?.encoding?.format ?? 'mp4';
      videoCodec.value =
        projectStore.projectSettings?.exportDefaults?.encoding?.videoCodec ?? 'avc1.640032';
      videoBitrateMbps.value =
        projectStore.projectSettings?.exportDefaults?.encoding?.bitrateMbps ?? 5;
      excludeAudio.value =
        projectStore.projectSettings?.exportDefaults?.encoding?.excludeAudio ?? false;
      audioCodec.value =
        projectStore.projectSettings?.exportDefaults?.encoding?.audioCodec ?? 'aac';
      audioBitrateKbps.value =
        projectStore.projectSettings?.exportDefaults?.encoding?.audioBitrateKbps ?? 128;

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(file);

        if (requestId !== conversionModalRequestId.value || targetEntry.value?.path !== entry.path)
          return;

        if (meta?.video) {
          videoWidth.value = Math.max(1, Math.round(Number(meta.video.width) || 1920));
          videoHeight.value = Math.max(1, Math.round(Number(meta.video.height) || 1080));
          videoFps.value = clampPositiveNumber(Number(meta.video.fps), 30);
          isCustomResolution.value = true;
        }

        if (meta?.audio) {
          audioChannels.value = resolveAudioChannelsFromMeta(meta.audio.channels);
          originalAudioSampleRate.value = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          audioSampleRate.value = 0;
        } else {
          originalAudioSampleRate.value = null;
          audioSampleRate.value = 0;
        }
      } catch {
        // ignore metadata errors
      }
    } else if (type === 'audio') {
      audioOnlyCodec.value = 'opus';
      audioOnlyFormat.value = 'opus';
      audioOnlyBitrateKbps.value = 128;
      audioChannels.value = 'stereo';
      originalAudioSampleRate.value = null;
      audioSampleRate.value = 0;

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(file);
        if (requestId !== conversionModalRequestId.value || targetEntry.value?.path !== entry.path)
          return;
        if (meta?.audio) {
          audioChannels.value = resolveAudioChannelsFromMeta(meta.audio.channels);
          originalAudioSampleRate.value = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          audioSampleRate.value = 0;
        } else {
          originalAudioSampleRate.value = null;
          audioSampleRate.value = 0;
        }
      } catch {
        // ignore metadata errors
      }
    } else if (type === 'image') {
      imageQuality.value = 80;

      try {
        const file = await fileManager.vfs.getFile(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const bitmap = await createImageBitmap(file);
        if (requestId !== conversionModalRequestId.value || targetEntry.value?.path !== entry.path)
          return;
        imageWidth.value = bitmap.width;
        imageHeight.value = bitmap.height;
        imageAspectRatio.value = bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
      } catch {
        imageWidth.value = 0;
        imageHeight.value = 0;
        imageAspectRatio.value = 1;
      }
    }
  }

  async function convertImage(params: {
    file: File;
    targetHandle: FileSystemFileHandle;
    request: ConversionRequest;
    taskId: string;
  }) {
    return addMediaTask(
      async () => {
        if (isCancelRequested.value && activeForegroundConversionTaskId.value === params.taskId) {
          return;
        }

        const bitmap = await createImageBitmap(params.file);
        const canvas = document.createElement('canvas');

        const targetWidth = Math.max(1, params.request.image?.width || bitmap.width);
        const targetHeight = Math.max(1, params.request.image?.height || bitmap.height);

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context');
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/webp', (params.request.image?.quality ?? 80) / 100);
        });

        if (!blob) throw new Error('Failed to create webp blob');

        const writable = await params.targetHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      },
      { priority: MEDIA_TASK_PRIORITIES.conversionInteractive },
    );
  }

  async function convertVideoAudio(params: {
    request: ConversionRequest;
    targetHandle: FileSystemFileHandle;
    taskId: string;
    backgroundTaskId?: string;
  }) {
    return addMediaTask(
      async () => {
        if (
          !params.backgroundTaskId &&
          isCancelRequested.value &&
          activeForegroundConversionTaskId.value === params.taskId
        ) {
          return;
        }
        if (params.backgroundTaskId) {
          backgroundTasksStore.updateTaskStatus(params.backgroundTaskId, 'running');
        }

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
            if (
              !params.backgroundTaskId &&
              activeForegroundConversionTaskId.value === params.taskId
            ) {
              conversionProgress.value = normalizedProgress;
            }
            if (params.backgroundTaskId) {
              backgroundTasksStore.updateTaskProgress(params.backgroundTaskId, normalizedProgress);
            }
          },
          onExportPhase: (phase) => {
            if (
              !params.backgroundTaskId &&
              activeForegroundConversionTaskId.value === params.taskId
            ) {
              conversionPhase.value = phase;
            }
          },
          onExportWarning: (message) => {
            console.warn(message);
          },
        });

        try {
          const sourceFile = await projectStore.getFileByPath(params.request.entry.path);
          if (!sourceFile) throw new Error('Failed to access source file');

          const meta = await client.extractMetadata(sourceFile);
          const durationUs = Math.round((meta.duration || 0) * 1_000_000);
          if (!durationUs && params.request.type === 'video') {
            throw new Error('Invalid media duration');
          }

          let exportOptions: any = {};
          let videoPayload: any[] = [];
          let audioPayload: any[] = [];

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

            videoPayload = [
              {
                kind: 'clip',
                id: 'convert_video',
                layer: 0,
                source: { path: params.request.entry.path },
                timelineRange: { startUs: 0, durationUs },
                sourceRange: { startUs: 0, durationUs },
              },
            ];

            if (!params.request.video.excludeAudio && meta.audio) {
              audioPayload = [
                {
                  kind: 'clip',
                  id: 'convert_audio',
                  layer: 0,
                  source: { path: params.request.entry.path },
                  timelineRange: { startUs: 0, durationUs },
                  sourceRange: { startUs: 0, durationUs },
                  audioGain: 1,
                },
              ];
            }
          } else if (params.request.audioOnly) {
            exportOptions = {
              format: resolveAudioOnlyContainerFormat(params.request.audioOnly.codec),
              videoCodec: 'none',
              bitrate: 100_000,
              audioBitrate: params.request.audioOnly.bitrateKbps * 1000,
              audio: true,
              audioCodec: params.request.audioOnly.codec,
              width: 16,
              height: 16,
              fps: 1,
              audioChannels: params.request.sharedAudio.channels,
              audioSampleRate: params.request.sharedAudio.sampleRate || undefined,
            };

            if (meta.audio) {
              audioPayload = [
                {
                  kind: 'clip',
                  id: 'convert_audio',
                  layer: 0,
                  source: { path: params.request.entry.path },
                  timelineRange: { startUs: 0, durationUs },
                  sourceRange: { startUs: 0, durationUs },
                  audioGain: 1,
                  speed: params.request.audioOnly.reverse ? -1 : 1,
                },
              ];
            }
          }

          await (client as any).exportTimeline(
            params.targetHandle,
            exportOptions,
            videoPayload,
            audioPayload,
            params.taskId,
          );
        } finally {
          unregisterExportTaskHostApi(params.taskId);
        }
      },
      {
        priority: params.backgroundTaskId
          ? MEDIA_TASK_PRIORITIES.conversionBackground
          : MEDIA_TASK_PRIORITIES.conversionInteractive,
      },
    );
  }

  async function startConversion() {
    if (!targetEntry.value || isConverting.value) return;

    isConverting.value = true;
    isCancelRequested.value = false;
    activeForegroundConversionTaskId.value = null;
    conversionError.value = null;
    conversionProgress.value = 0;
    conversionPhase.value = null;

    let createdFileName: string | null = null;
    let createdDirHandle: FileSystemDirectoryHandle | null = null;
    let dirPath = '';

    try {
      const entry = targetEntry.value;
      const request = buildConversionRequest(entry);
      const sourceFile = await projectStore.getFileByPath(entry.path);
      if (!sourceFile) throw new Error('Failed to access source file');
      const taskId = createConversionTaskId();

      createdFileName = request.newFileName;

      dirPath = request.dirPath;
      const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
      if (!dirHandle) throw new Error('Target directory not found');

      createdDirHandle = dirHandle;

      const targetHandle = await dirHandle.getFileHandle(request.newFileName, { create: true });

      if (request.type === 'image') {
        activeForegroundConversionTaskId.value = taskId;
        await convertImage({ file: sourceFile, targetHandle, request, taskId });
      } else if (request.type === 'audio') {
        activeForegroundConversionTaskId.value = taskId;
        await convertVideoAudio({ request, targetHandle, taskId });
      } else if (request.type === 'video') {
        const bgTaskId = backgroundTasksStore.addTask({
          type: 'conversion',
          title: t('videoEditor.fileManager.convert.bgTaskTitle', `Converting: ${entry.name}`),
          status: 'pending',
          cancel: async () => {
            const { client } = getExportWorkerClient();
            await client.cancelExport(taskId);
          },
        });

        toast.add({
          title: t(
            'videoEditor.fileManager.convert.bgTaskAdded',
            'Video conversion started in background',
          ),
          color: 'neutral',
        });

        isModalOpen.value = false;

        convertVideoAudio({
          request,
          targetHandle,
          taskId,
          backgroundTaskId: bgTaskId,
        })
          .then(async () => {
            backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
            toast.add({
              title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
              color: 'success',
            });
          })
          .catch(async (err) => {
            if (isAbortError(err)) {
              backgroundTasksStore.updateTaskStatus(bgTaskId, 'cancelled');
              await removeCreatedFile({ dirHandle: createdDirHandle, fileName: createdFileName });
            } else {
              backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', err.message);
              console.error('Video conversion failed', err);
            }
          })
          .finally(async () => {
            isConverting.value = false;
            await fileManager.reloadDirectory(dirPath);
            uiStore.notifyFileManagerUpdate();
          });

        return; // Don't block startConversion for video
      }

      if (isCancelRequested.value) {
        await removeCreatedFile({ dirHandle: createdDirHandle, fileName: createdFileName });
        await fileManager.reloadDirectory(dirPath);
        uiStore.notifyFileManagerUpdate();
        toast.add({
          title: t('videoEditor.fileManager.convert.cancelled', 'Conversion cancelled'),
          color: 'neutral',
        });
        isModalOpen.value = false;
        return;
      }

      toast.add({
        title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
        color: 'success',
      });

      await fileManager.reloadDirectory(dirPath);
      uiStore.notifyFileManagerUpdate();
      isModalOpen.value = false;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Conversion failed', err);
      if (isCancelRequested.value || isAbortError(error)) {
        await removeCreatedFile({ dirHandle: createdDirHandle, fileName: createdFileName });
        await fileManager.reloadDirectory(dirPath);
        uiStore.notifyFileManagerUpdate();
        toast.add({
          title: t('videoEditor.fileManager.convert.cancelled', 'Conversion cancelled'),
          color: 'neutral',
        });
        isModalOpen.value = false;
      } else {
        conversionError.value = error.message || 'Failed to convert file';
      }
    } finally {
      activeForegroundConversionTaskId.value = null;
      isConverting.value = false;
    }
  }

  async function cancelConversion() {
    if (!isConverting.value) return;
    const taskId = activeForegroundConversionTaskId.value;
    if (!taskId) {
      isCancelRequested.value = true;
      return;
    }

    const { client } = getExportWorkerClient();
    if (client && typeof client.cancelExport === 'function') {
      await client.cancelExport(taskId);
    }
    isCancelRequested.value = true;
  }

  return {
    isModalOpen,
    targetEntry,
    mediaType,
    isConverting,
    conversionProgress,
    conversionError,
    conversionPhase,
    videoFormat,
    videoCodec,
    videoBitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    bitrateMode,
    keyframeIntervalSec,
    videoWidth,
    videoHeight,
    videoFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    audioOnlyFormat,
    audioOnlyCodec,
    audioOnlyBitrateKbps,
    audioChannels,
    audioSampleRate,
    audioReverse,
    originalAudioSampleRate,
    imageQuality,
    imageWidth,
    imageHeight,
    isImageResolutionLinked,
    imageAspectRatio,
    openConversionModal,
    startConversion,
    cancelConversion,
  };
}
