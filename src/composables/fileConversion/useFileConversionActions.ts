import type { Ref, ComputedRef } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { getExportWorkerClient } from '~/utils/video-editor/worker-client';
import type { ConversionRequest } from '~/types/conversion';
import { dirname } from '~/utils/path';
import {
  clampPositiveNumber,
  createConversionTaskId,
  isAbortError,
  removeCreatedFile,
} from '~/utils/conversion/helpers';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { executeImageConversion } from '~/utils/conversion/image-conversion';
import {
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_CODEC,
  DEFAULT_VIDEO_BITRATE_MBPS,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_AUDIO_BITRATE_KBPS,
  DEFAULT_KEYFRAME_INTERVAL_SEC,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_VIDEO_FPS,
  DEFAULT_IMAGE_QUALITY,
} from '~/utils/conversion/constants';

interface UseFileConversionActionsProps {
  targetEntry: Ref<FsEntry | null>;
  mediaType: ComputedRef<'video' | 'audio' | 'image' | 'text' | 'timeline' | 'unknown' | null>;
  videoSettings: any;
  audioSettings: any;
  imageSettings: any;
  isCancelRequested: Ref<boolean>;
  isConverting: Ref<boolean>;
  conversionError: Ref<string>;
  isModalOpen: Ref<boolean>;
  conversionModalRequestId: Ref<number>;
  callbacks?: {
    onSuccess?: (type: 'bgTaskAdded' | 'success', bgTaskTitle?: string) => void;
    onError?: (error: Error) => void;
  };
}

export function useFileConversionActions(props: UseFileConversionActionsProps) {
  function resolveAudioChannelsFromMeta(channels?: number): 'stereo' | 'mono' {
    if (!channels) return 'stereo';
    if (channels === 1) return 'mono';
    return 'stereo';
  }

  async function openConversionModal(entry: FsEntry) {
    const projectStore = useProjectStore();
    const fileManager = useFileManager();

    const requestId = props.conversionModalRequestId.value + 1;
    props.conversionModalRequestId.value = requestId;
    props.targetEntry.value = entry;
    
    // We need to wait for the mediaType computed to update based on the new targetEntry
    // But since it's computed, we can just calculate the type here temporarily or wait
    const type = entry.name.split('.').pop()?.toLowerCase() || '';
    const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(type);
    const isAudio = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'].includes(type);
    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(type);
    
    const mediaCategory = isVideo ? 'video' : isAudio ? 'audio' : isImage ? 'image' : 'unknown';

    props.isCancelRequested.value = false;
    props.isConverting.value = false;
    props.conversionError.value = '';
    props.isModalOpen.value = true;

    if (mediaCategory === 'video') {
      props.videoSettings.format =
        projectStore.projectSettings?.exportDefaults?.encoding?.format ?? DEFAULT_VIDEO_FORMAT;
      props.videoSettings.videoCodec =
        projectStore.projectSettings?.exportDefaults?.encoding?.videoCodec ?? DEFAULT_VIDEO_CODEC;
      props.videoSettings.bitrateMbps =
        projectStore.projectSettings?.exportDefaults?.encoding?.bitrateMbps ??
        DEFAULT_VIDEO_BITRATE_MBPS;
      props.videoSettings.excludeAudio =
        projectStore.projectSettings?.exportDefaults?.encoding?.excludeAudio ?? false;
      props.videoSettings.audioCodec =
        projectStore.projectSettings?.exportDefaults?.encoding?.audioCodec ?? DEFAULT_AUDIO_CODEC;
      props.videoSettings.audioBitrateKbps =
        projectStore.projectSettings?.exportDefaults?.encoding?.audioBitrateKbps ??
        DEFAULT_AUDIO_BITRATE_KBPS;

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(file);

        if (requestId !== props.conversionModalRequestId.value || props.targetEntry.value?.path !== entry.path)
          return;

        if (meta?.video) {
          props.videoSettings.width = Math.max(
            1,
            Math.round(Number(meta.video.width) || DEFAULT_VIDEO_WIDTH),
          );
          props.videoSettings.height = Math.max(
            1,
            Math.round(Number(meta.video.height) || DEFAULT_VIDEO_HEIGHT),
          );
          props.videoSettings.fps = clampPositiveNumber(Number(meta.video.fps), DEFAULT_VIDEO_FPS);
          props.videoSettings.isCustomResolution = true;
        }

        if (meta?.audio) {
          props.audioSettings.channels = resolveAudioChannelsFromMeta(meta.audio.channels);
          props.audioSettings.originalSampleRate = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          props.audioSettings.sampleRate = 0;
        } else {
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.sampleRate = 0;
        }
      } catch (err) {
        console.warn('Failed to extract video metadata', err);
      }
    } else if (mediaCategory === 'audio') {
      // Reset to defaults
      props.audioSettings.onlyCodec = 'opus';
      props.audioSettings.onlyFormat = 'opus';
      props.audioSettings.onlyBitrateKbps = DEFAULT_AUDIO_BITRATE_KBPS;
      props.audioSettings.channels = 'stereo';
      props.audioSettings.originalSampleRate = null;
      props.audioSettings.sampleRate = 0;

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(file);
        
        if (requestId !== props.conversionModalRequestId.value || props.targetEntry.value?.path !== entry.path)
          return;
          
        if (meta?.audio) {
          props.audioSettings.channels = resolveAudioChannelsFromMeta(meta.audio.channels);
          props.audioSettings.originalSampleRate = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          props.audioSettings.sampleRate = 0;
        } else {
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.sampleRate = 0;
        }
      } catch (err) {
        console.warn('Failed to extract audio metadata', err);
      }
    } else if (mediaCategory === 'image') {
      props.imageSettings.quality = DEFAULT_IMAGE_QUALITY;

      try {
        const file = await fileManager.vfs.getFile(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const bitmap = await createImageBitmap(file);
        if (
          requestId !== props.conversionModalRequestId.value ||
          props.targetEntry.value?.path !== entry.path
        ) {
          bitmap.close();
          return;
        }
        props.imageSettings.width = bitmap.width;
        props.imageSettings.height = bitmap.height;
        props.imageSettings.aspectRatio = bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
        bitmap.close();
      } catch (err) {
        console.warn('Failed to extract image metadata', err);
        props.imageSettings.width = 0;
        props.imageSettings.height = 0;
        props.imageSettings.aspectRatio = 1;
      }
    }
  }

  function buildConversionRequest(entry: FsEntry): ConversionRequest {
    const type = props.mediaType.value;
    if (type !== 'video' && type !== 'audio' && type !== 'image') {
      throw new Error('Unsupported media type');
    }

    const baseName = entry.name.replace(/\.[^.]+$/, '');
    let newExt = '';
    if (type === 'image') newExt = 'webp';
    else if (type === 'audio') newExt = props.audioSettings.onlyFormat;
    else newExt = props.videoSettings.format;

    const sampleRate =
      props.audioSettings.sampleRate === 0
        ? props.audioSettings.originalSampleRate
        : clampPositiveNumber(Number(props.audioSettings.sampleRate), 0);

    const dirPath = dirname(entry.path);

    const request: ConversionRequest = {
      entry,
      type,
      dirPath,
      newFileName: `${baseName}_converted.${newExt}`,
      sharedAudio: {
        channels: props.audioSettings.channels,
        sampleRate: sampleRate && sampleRate > 0 ? sampleRate : null,
      },
    };

    if (type === 'video') {
      request.video = {
        format: props.videoSettings.format,
        videoCodec: props.videoSettings.videoCodec,
        bitrateMbps: clampPositiveNumber(props.videoSettings.bitrateMbps, 5),
        excludeAudio: props.videoSettings.excludeAudio,
        audioCodec: props.videoSettings.audioCodec,
        audioBitrateKbps: clampPositiveNumber(props.videoSettings.audioBitrateKbps, 128),
        bitrateMode: props.videoSettings.bitrateMode,
        keyframeIntervalSec: clampPositiveNumber(props.videoSettings.keyframeIntervalSec, 2),
        width: Math.max(1, Math.round(Number(props.videoSettings.width) || DEFAULT_VIDEO_WIDTH)),
        height: Math.max(1, Math.round(Number(props.videoSettings.height) || DEFAULT_VIDEO_HEIGHT)),
        fps: clampPositiveNumber(Number(props.videoSettings.fps), DEFAULT_VIDEO_FPS),
      };
    } else if (type === 'audio') {
      request.audioOnly = {
        codec: props.audioSettings.onlyCodec,
        bitrateKbps: clampPositiveNumber(props.audioSettings.onlyBitrateKbps, 128),
        reverse: props.audioSettings.reverse,
      };
    } else {
      request.image = {
        quality: Math.max(
          1,
          Math.min(100, Math.round(Number(props.imageSettings.quality) || DEFAULT_IMAGE_QUALITY)),
        ),
        width: Math.max(1, Math.round(Number(props.imageSettings.width) || 1)),
        height: Math.max(1, Math.round(Number(props.imageSettings.height) || 1)),
      };
    }

    return request;
  }

  async function startConversion() {
    if (!props.targetEntry.value) return;

    props.isCancelRequested.value = false;
    props.conversionError.value = '';

    const projectStore = useProjectStore();
    const fileManager = useFileManager();
    const uiStore = useUiStore();
    const backgroundTasksStore = useBackgroundTasksStore();

    let createdFileName: string | null = null;
    let createdDirHandle: FileSystemDirectoryHandle | null = null;
    let dirPath = '';

    try {
      const entry = props.targetEntry.value;
      const request = buildConversionRequest(entry);
      const taskId = createConversionTaskId();

      createdFileName = request.newFileName;
      dirPath = request.dirPath;
      const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
      if (!dirHandle) throw new Error('Target directory not found');

      createdDirHandle = dirHandle;

      const targetHandle = await dirHandle.getFileHandle(request.newFileName, { create: true });

      if (request.type === 'video' || request.type === 'audio') {
        const title = `Converting: ${entry.name}`;
        const bgTaskId = backgroundTasksStore.addTask({
          type: 'conversion',
          title,
          status: 'pending',
          cancel: async () => {
            const { client } = getExportWorkerClient();
            await client.cancelExport(taskId);
          },
        });

        props.callbacks?.onSuccess?.('bgTaskAdded', title);
        props.isModalOpen.value = false;

        executeMediaConversion({
          request,
          targetHandle,
          taskId,
          backgroundTaskId: bgTaskId,
          isCancelRequested: () => false, // BG task handles cancel internally via cancelExport
        })
          .then(async () => {
            backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
            props.callbacks?.onSuccess?.('success');
          })
          .catch(async (err) => {
            if (isAbortError(err)) {
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
      } else if (request.type === 'image') {
        // Images convert in foreground
        props.isConverting.value = true;
        const sourceFile = await projectStore.getFileByPath(entry.path);
        if (!sourceFile) throw new Error('Failed to access source file');

        try {
          await executeImageConversion({
            file: sourceFile,
            targetHandle,
            request,
            taskId,
            isCancelRequested: () => props.isCancelRequested.value,
          });
          props.callbacks?.onSuccess?.('success');
          props.isModalOpen.value = false;
        } catch (err) {
          if (isAbortError(err) || props.isCancelRequested.value) {
            await removeCreatedFile({ dirHandle: createdDirHandle, fileName: createdFileName });
          } else {
            props.conversionError.value = err instanceof Error ? err.message : String(err);
            props.callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        } finally {
          props.isConverting.value = false;
          await fileManager.reloadDirectory(dirPath);
          uiStore.notifyFileManagerUpdate();
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Conversion initiation failed', err);
      props.isModalOpen.value = false;
      props.callbacks?.onError?.(error);
    }
  }

  function cancelConversion() {
    props.isCancelRequested.value = true;
  }

  return {
    openConversionModal,
    startConversion,
    cancelConversion,
  };
}
