import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { getExportWorkerClient } from '~/utils/video-editor/worker-client';
import type { ConversionRequest } from '~/types/conversion';
import {
  clampPositiveNumber,
  createConversionTaskId,
  isAbortError,
  removeCreatedFile,
} from '~/utils/conversion/helpers';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { executeImageConversion } from '~/utils/conversion/image-conversion';

export const useFileConversionStore = defineStore('file-conversion', () => {
  const isModalOpen = ref(false);
  const targetEntry = ref<FsEntry | null>(null);

  const mediaType = computed(() => {
    if (!targetEntry.value) return null;
    return getMediaTypeFromFilename(targetEntry.value.name);
  });

  const isCancelRequested = ref(false);

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

  function resetState() {
    isCancelRequested.value = false;
  }

  function resolveAudioChannelsFromMeta(channels?: number): 'stereo' | 'mono' {
    if (!channels) return 'stereo';
    if (channels === 1) return 'mono';
    return 'stereo';
  }

  async function openConversionModal(entry: FsEntry) {
    const projectStore = useProjectStore();
    const fileManager = useFileManager();

    const requestId = conversionModalRequestId.value + 1;
    conversionModalRequestId.value = requestId;
    targetEntry.value = entry;
    const type = mediaType.value;

    resetState();
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
        if (requestId !== conversionModalRequestId.value || targetEntry.value?.path !== entry.path) {
          bitmap.close();
          return;
        }
        imageWidth.value = bitmap.width;
        imageHeight.value = bitmap.height;
        imageAspectRatio.value = bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
        bitmap.close();
      } catch {
        imageWidth.value = 0;
        imageHeight.value = 0;
        imageAspectRatio.value = 1;
      }
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

    const dirPath = entry.path.split('/').slice(0, -1).join('/') || '';

    const request: ConversionRequest = {
      entry,
      type,
      dirPath,
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

  async function startConversion(t: (key: string, fallback: string) => string, toast: any) {
    if (!targetEntry.value) return;

    isCancelRequested.value = false;

    const projectStore = useProjectStore();
    const fileManager = useFileManager();
    const uiStore = useUiStore();
    const backgroundTasksStore = useBackgroundTasksStore();

    let createdFileName: string | null = null;
    let createdDirHandle: FileSystemDirectoryHandle | null = null;
    let dirPath = '';

    try {
      const entry = targetEntry.value;
      const request = buildConversionRequest(entry);
      const taskId = createConversionTaskId();

      createdFileName = request.newFileName;
      dirPath = request.dirPath;
      const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
      if (!dirHandle) throw new Error('Target directory not found');

      createdDirHandle = dirHandle;

      const targetHandle = await dirHandle.getFileHandle(request.newFileName, { create: true });

      const bgTaskId = backgroundTasksStore.addTask({
        type: 'conversion',
        title: t('videoEditor.fileManager.convert.bgTaskTitle', `Converting: ${entry.name}`),
        status: 'pending',
        cancel: async () => {
          if (request.type === 'video' || request.type === 'audio') {
             const { client } = getExportWorkerClient();
             await client.cancelExport(taskId);
          } else {
             isCancelRequested.value = true;
          }
        },
      });

      toast.add({
        title: t(
          'videoEditor.fileManager.convert.bgTaskAdded',
          'Conversion started in background',
        ),
        color: 'neutral',
      });

      isModalOpen.value = false;

      const runConversion = async () => {
        if (request.type === 'image') {
          backgroundTasksStore.updateTaskStatus(bgTaskId, 'running');
          const sourceFile = await projectStore.getFileByPath(entry.path);
          if (!sourceFile) throw new Error('Failed to access source file');
          await executeImageConversion({ file: sourceFile, targetHandle, request, taskId, isCancelRequested: () => isCancelRequested.value });
        } else {
          await executeMediaConversion({
            request,
            targetHandle,
            taskId,
            backgroundTaskId: bgTaskId,
            isCancelRequested: () => isCancelRequested.value,
          });
        }
      };

      runConversion()
        .then(async () => {
          backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
          backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
          toast.add({
            title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
            color: 'success',
          });
        })
        .catch(async (err) => {
          if (isAbortError(err) || isCancelRequested.value) {
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'cancelled');
            await removeCreatedFile({ dirHandle: createdDirHandle, fileName: createdFileName });
          } else {
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', err.message);
            console.error('Conversion failed', err);
          }
        })
        .finally(async () => {
          await fileManager.reloadDirectory(dirPath);
          uiStore.notifyFileManagerUpdate();
        });

      return;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Conversion initiation failed', err);
      toast.add({
        title: t('videoEditor.fileManager.convert.failed', 'Conversion failed to start'),
        description: error.message,
        color: 'error',
      });
      isModalOpen.value = false;
    }
  }

  function cancelConversion() {
    isCancelRequested.value = true;
  }

  return {
    isModalOpen,
    targetEntry,
    mediaType,
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
});
