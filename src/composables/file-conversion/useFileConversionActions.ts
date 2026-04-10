import type { Ref, ComputedRef } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getExportWorkerClient, restartExportWorker } from '~/utils/video-editor/worker-client';
import type { ConversionRequest } from '~/types/conversion';
import { dirname } from '~/utils/path';
import {
  clampPositiveNumber,
  createConversionTaskId,
  isAbortError,
  removeCreatedFile,
  resolveAudioChannelsFromMeta,
  resolveAudioOnlyFileExtension,
} from '~/utils/conversion/helpers';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { convertImageFile } from '~/utils/conversion/image-conversion';
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

const METADATA_TIMEOUT_MS = 15000;

interface UseFileConversionActionsProps {
  targetEntry: Ref<FsEntry | null>;
  mediaType: ComputedRef<'video' | 'audio' | 'image' | 'text' | 'timeline' | 'unknown' | null>;
  videoSettings: {
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
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
  };
  audioSettings: {
    onlyFormat: 'opus' | 'aac';
    onlyCodec: 'opus' | 'aac';
    onlyBitrateKbps: number;
    channels: number;
    sampleRate: number;
    reverse: boolean;
    originalSampleRate: number | null;
    originalChannels: number | null;
  };
  imageSettings: {
    quality: number;
    width: number;
    height: number;
    isResolutionLinked: boolean;
    aspectRatio: number;
  };
  isCancelRequested: Ref<boolean>;
  isConverting: Ref<boolean>;
  conversionError: Ref<string>;
  isModalOpen: Ref<boolean>;
  conversionModalRequestId: Ref<number>;
  sourceHasAudio: Ref<boolean>;
  callbacks?: {
    onSuccess?: (type: 'bgTaskAdded' | 'success', bgTaskTitle?: string) => void;
    onError?: (error: Error) => void;
    onWarning?: (message: string) => void;
  };
}

export function useFileConversionActions(props: UseFileConversionActionsProps) {
  const projectStore = useProjectStore();
  const fileManager = useFileManager();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();

  function syncAudioOnlyCodecWithFormat() {
    props.audioSettings.onlyCodec = props.audioSettings.onlyFormat;
  }

  function notifyMetadataWarning(message: string, error: unknown) {
    console.warn(message, error);
    props.callbacks?.onWarning?.(message);
  }

  async function extractMetadataWithTimeout(file: File) {
    const { client } = getExportWorkerClient();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        restartExportWorker();
        reject(new Error('Metadata extraction timed out'));
      }, METADATA_TIMEOUT_MS);
    });

    try {
      return await Promise.race([client.extractMetadata(file), timeoutPromise]);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  async function openConversionModal(entry: FsEntry) {
    const requestId = props.conversionModalRequestId.value + 1;
    props.conversionModalRequestId.value = requestId;
    props.targetEntry.value = entry;

    const mediaCategory = getMediaTypeFromFilename(entry.name);

    props.isCancelRequested.value = false;
    props.isConverting.value = false;
    props.conversionError.value = '';
    props.isModalOpen.value = true;

    // Default to VBR as requested
    props.videoSettings.bitrateMode = 'variable';

    if (mediaCategory === 'video') {
      props.sourceHasAudio.value = true;
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
        const meta = await extractMetadataWithTimeout(file);

        if (
          requestId !== props.conversionModalRequestId.value ||
          props.targetEntry.value?.path !== entry.path
        )
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

          // Detect format and codec from meta
          const sourceExt = entry.name.split('.').pop()?.toLowerCase();
          const sourceCodec = String(meta.video.codec || '').toLowerCase();
          const supportedFormats: any[] = ['mp4', 'webm', 'mkv'];

          let matched = false;

          // Soft resolve codec: check if any of our supported codecs is a prefix of the source codec
          const supportedCodec = ['avc1', 'vp09', 'av01'].find((prefix) =>
            sourceCodec.startsWith(prefix),
          );

          if (supportedCodec) {
            // Map to our specific codec strings
            if (supportedCodec === 'avc1') props.videoSettings.videoCodec = 'avc1.640032';
            else if (supportedCodec === 'vp09') props.videoSettings.videoCodec = 'vp09.00.10.08';
            else if (supportedCodec === 'av01') props.videoSettings.videoCodec = 'av01.0.05M.08';

            // If format is also supported, use it, otherwise default to mp4
            if (sourceExt && supportedFormats.includes(sourceExt)) {
              props.videoSettings.format = sourceExt as any;
            } else {
              props.videoSettings.format = 'mp4';
            }
            matched = true;
          }

          if (!matched) {
            props.videoSettings.format = 'mp4';
            props.videoSettings.videoCodec = 'av01.0.05M.08'; // Default to MP4 + AV1 as requested
          }

          props.videoSettings.bitrateMbps = meta.video.bitrate
            ? Number((meta.video.bitrate / 1_000_000).toFixed(2))
            : 0;
        }

        if (meta?.audio) {
          props.sourceHasAudio.value = true;
          props.audioSettings.originalChannels = meta.audio.channels || 2;
          props.audioSettings.channels = props.audioSettings.originalChannels || 2;
          props.audioSettings.originalSampleRate = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          // Auto-select sample rate from meta
          props.audioSettings.sampleRate = props.audioSettings.originalSampleRate || 0;
          props.audioSettings.onlyBitrateKbps = meta.audio.bitrate
            ? Math.round(meta.audio.bitrate / 1000)
            : 0;
          props.videoSettings.audioBitrateKbps = props.audioSettings.onlyBitrateKbps || 0;
        } else {
          props.sourceHasAudio.value = false;
          props.videoSettings.excludeAudio = true;
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.sampleRate = 0;
          props.audioSettings.onlyBitrateKbps = 0;
        }
      } catch (err) {
        notifyMetadataWarning(
          'Failed to extract video metadata. Default conversion settings will be used.',
          err,
        );
        props.videoSettings.bitrateMbps = 0;
        props.videoSettings.audioBitrateKbps = 0;
        props.audioSettings.onlyBitrateKbps = 0;
      }
    } else if (mediaCategory === 'audio') {
      props.sourceHasAudio.value = true;
      // Reset to defaults
      props.audioSettings.onlyCodec = 'opus';
      props.audioSettings.onlyFormat = 'opus';
      props.audioSettings.onlyBitrateKbps = DEFAULT_AUDIO_BITRATE_KBPS;
      props.audioSettings.channels = 2;
      props.audioSettings.originalSampleRate = null;
      props.audioSettings.originalChannels = null;
      props.audioSettings.sampleRate = 0;
      syncAudioOnlyCodecWithFormat();

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const meta = await extractMetadataWithTimeout(file);

        if (
          requestId !== props.conversionModalRequestId.value ||
          props.targetEntry.value?.path !== entry.path
        )
          return;

        if (meta?.audio) {
          props.audioSettings.originalChannels = meta.audio.channels || 2;
          props.audioSettings.channels = props.audioSettings.originalChannels || 2;
          props.audioSettings.originalSampleRate = Math.max(
            1,
            Math.round(Number(meta.audio.sampleRate) || 0),
          );
          props.audioSettings.sampleRate = props.audioSettings.originalSampleRate || 0;
          props.audioSettings.onlyBitrateKbps = meta.audio.bitrate
            ? Math.round(meta.audio.bitrate / 1000)
            : 0;
        } else {
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.originalChannels = null;
          props.audioSettings.sampleRate = 0;
          props.audioSettings.onlyBitrateKbps = 0;
        }
      } catch (err) {
        notifyMetadataWarning(
          'Failed to extract audio metadata. Default conversion settings will be used.',
          err,
        );
      }
    } else if (mediaCategory === 'image') {
      props.sourceHasAudio.value = false;
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
    else if (type === 'audio') {
      syncAudioOnlyCodecWithFormat();
      newExt = resolveAudioOnlyFileExtension(props.audioSettings.onlyCodec);
    } else newExt = props.videoSettings.format;

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
        excludeAudio: !props.sourceHasAudio.value || props.videoSettings.excludeAudio,
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

    let createdFileName: string | null = null;
    let createdFilePath: string | null = null;
    let createdDirHandle: FileSystemDirectoryHandle | null = null;
    let dirPath = '';

    try {
      const entry = props.targetEntry.value;
      const request = buildConversionRequest(entry);
      const taskId = createConversionTaskId();

      createdFileName = request.newFileName;
      dirPath = request.dirPath;
      createdFilePath = dirPath ? `${dirPath}/${request.newFileName}` : request.newFileName;

      if (request.type === 'video' || request.type === 'audio') {
        const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
        if (!dirHandle) throw new Error('Target directory not found');

        createdDirHandle = dirHandle;

        const targetHandle = await dirHandle.getFileHandle(request.newFileName, { create: true });
        const title = `Converting: ${entry.name}`;
        const bgTaskId = backgroundTasksStore.addTask({
          type: 'conversion',
          title,
          status: 'pending',
          cancel: async () => {
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'cancelled');
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
          isCancelRequested: () => {
            const task = backgroundTasksStore.tasks.find((item) => item.id === bgTaskId);
            return task?.status === 'cancelled';
          },
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
        const sourceFile = await fileManager.vfs.getFile(entry.path);
        if (!sourceFile) throw new Error('Failed to access source file');

        try {
          const blob = await convertImageFile({
            file: sourceFile,
            request,
            taskId,
            isCancelRequested: () => props.isCancelRequested.value,
          });
          if (!createdFilePath) throw new Error('Failed to resolve target path');
          await fileManager.vfs.writeFile(createdFilePath, blob);
          props.callbacks?.onSuccess?.('success');
          props.isModalOpen.value = false;
        } catch (err) {
          if (isAbortError(err) || props.isCancelRequested.value) {
            if (createdFilePath) {
              await fileManager.vfs.deleteEntry(createdFilePath).catch(() => {});
            }
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
