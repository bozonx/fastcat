import { createDevLogger } from '~/utils/dev-logger';
import type { Ref, ComputedRef } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import { getExportWorkerClient, restartExportWorker } from '~/utils/video-editor/worker-client';
import { getWorkspaceFileHandle } from '~/utils/workspace-fs';
import { isTauriRuntime } from '~/utils/runtime';
import type { ConversionRequest } from '~/types/conversion';
import {
  clampPositiveNumber,
  createConversionTaskId,
  isAbortError,
  removeCreatedFile,
  resolveAudioOnlyFileExtension,
  resolveUniqueFileName,
} from '~/utils/conversion/helpers';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { convertImageFile } from '~/utils/conversion/image-conversion';
import {
  getNativeFileHandlePath,
  nativeCancelMediaTask,
  nativeConvertMedia,
  nativeMediaMetadata,
} from '~/utils/tauri-media-processing';
import { createGroupedWarningReporter } from '~/utils/grouped-warnings';
import { useMobileLayout } from '~/composables/useMobileLayout';
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
const log = createDevLogger('useFileConversionActions');

const METADATA_TIMEOUT_MS = 15000;

interface UseFileConversionActionsProps {
  targetEntry: Ref<FsEntry | null>;
  targetIsExternal: Ref<boolean>;
  targetVfs: Ref<IFileSystemAdapter | null>;
  targetReloadDirectory: Ref<((path: string) => Promise<void>) | null>;
  mediaType: Ref<'video' | 'audio' | 'image' | 'text' | 'timeline' | 'unknown' | null>;
  videoSettings: {
    format: 'mp4' | 'webm' | 'mkv';
    videoCodec: string;
    bitrateMbps: number;
    excludeAudio: boolean;
    audioCodec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3';
    audioBitrateKbps: number;
    bitrateMode: 'constant' | 'variable';
    keyframeIntervalSec: number;
    fastStart: boolean;
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
  };
  audioSettings: {
    onlyFormat: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3';
    onlyBitrateKbps: number;
    channels: number;
    sampleRate: number | 'original';
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
  isExtractingMetadata: Ref<boolean>;
  conversionError: Ref<string>;
  conversionWarnings: Ref<string[]>;
  isModalOpen: Ref<boolean>;
  conversionModalRequestId: Ref<number>;
  sourceHasAudio: Ref<boolean>;
  fileManager: {
    vfs: IFileSystemAdapter;
    reloadDirectory: (path: string) => Promise<void>;
  };
}

export function useFileConversionActions(props: UseFileConversionActionsProps) {
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const { isMobileLayout } = useMobileLayout();
  const { t } = useI18n();
  const toast = useToast();

  function getSiblingTarget(
    entryPath: string,
    fileName: string,
  ): { dirPath: string; filePath: string } {
    const separatorIndex = entryPath.lastIndexOf('/');
    if (separatorIndex < 0) {
      return {
        dirPath: '',
        filePath: fileName,
      };
    }

    if (separatorIndex === 0) {
      return {
        dirPath: '/',
        filePath: `/${fileName}`,
      };
    }

    const dirPath = entryPath.slice(0, separatorIndex);
    return {
      dirPath,
      filePath: `${dirPath}/${fileName}`,
    };
  }

  function notifyMetadataWarning(message: string, error: unknown) {
    log.warn(message, error);
    toast.add({
      title: t('videoEditor.fileManager.convert.metadataWarning'),
      description: message,
      color: 'warning',
    });
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

  async function extractEntryMetadata(path: string, file: File) {
    if (isTauriRuntime()) {
      const handle = await projectStore.getFileHandleByPath(path);
      const nativePath = getNativeFileHandlePath(handle);
      if (nativePath) {
        return await nativeMediaMetadata(nativePath);
      }
      throw new Error('Could not resolve native file path for metadata extraction');
    }

    return await extractMetadataWithTimeout(file);
  }

  async function resolveImageSourceFile(path: string): Promise<File | null> {
    const targetVfs = props.targetVfs.value;
    if (targetVfs) {
      try {
        const file = await targetVfs.getFile(path);
        if (file) return file;
      } catch {
        // Ignore VFS read errors and fall back to other sources.
      }
    }

    try {
      const file = await props.fileManager.vfs.getFile(path);
      if (file) return file;
    } catch {
      // Ignore VFS read errors and fall back to project FS.
    }

    return await projectStore.getFileByPath(path);
  }

  async function openConversionModal(
    entry: FsEntry,
    options?: {
      isExternal?: boolean;
      vfs?: IFileSystemAdapter | null;
      reloadDirectory?: ((path: string) => Promise<void>) | null;
    },
  ) {
    const requestId = props.conversionModalRequestId.value + 1;
    props.conversionModalRequestId.value = requestId;
    props.targetEntry.value = entry;
    props.targetIsExternal.value = options?.isExternal === true;
    props.targetVfs.value = options?.vfs ?? null;
    props.targetReloadDirectory.value = options?.reloadDirectory ?? null;

    const mediaCategory = getMediaTypeFromFilename(entry.name);

    props.isCancelRequested.value = false;
    props.isConverting.value = false;
    props.isExtractingMetadata.value = true;
    props.conversionError.value = '';
    props.conversionWarnings.value = [];
    props.isModalOpen.value = true;

    // Default to VBR as requested
    props.videoSettings.bitrateMode = 'variable';

    if (mediaCategory === 'video') {
      props.sourceHasAudio.value = true;
      props.videoSettings.format =
        projectStore.projectSettings?.exportSettings?.outputFormat ?? DEFAULT_VIDEO_FORMAT;
      props.videoSettings.videoCodec =
        projectStore.projectSettings?.exportSettings?.videoCodec ?? DEFAULT_VIDEO_CODEC;
      props.videoSettings.bitrateMbps =
        projectStore.projectSettings?.exportSettings?.bitrateMbps ?? DEFAULT_VIDEO_BITRATE_MBPS;
      props.videoSettings.excludeAudio =
        projectStore.projectSettings?.exportSettings?.excludeAudio ?? false;
      props.videoSettings.audioCodec =
        projectStore.projectSettings?.exportSettings?.audioCodec ?? DEFAULT_AUDIO_CODEC;
      props.videoSettings.audioBitrateKbps =
        projectStore.projectSettings?.exportSettings?.audioBitrateKbps ??
        DEFAULT_AUDIO_BITRATE_KBPS;

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const meta = await extractEntryMetadata(entry.path, file);

        if (
          requestId !== props.conversionModalRequestId.value ||
          props.targetEntry.value?.path !== entry.path
        )
          return;

        if (meta?.video) {
          props.videoSettings.width =
            Math.round((Number(meta.video.width) || DEFAULT_VIDEO_WIDTH) / 2) * 2;
          props.videoSettings.height =
            Math.round((Number(meta.video.height) || DEFAULT_VIDEO_HEIGHT) / 2) * 2;
          props.videoSettings.fps = clampPositiveNumber(Number(meta.video.fps), DEFAULT_VIDEO_FPS);
          props.videoSettings.isCustomResolution = true;

          // Detect format and codec from meta
          const sourceExt = entry.name.split('.').pop()?.toLowerCase();
          const sourceCodec = String(meta.video.codec || '').toLowerCase();
          const supportedFormats: ('mp4' | 'webm' | 'mkv')[] = ['mp4', 'webm', 'mkv'];

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
            if (sourceExt && supportedFormats.includes(sourceExt as 'mp4' | 'webm' | 'mkv')) {
              props.videoSettings.format = sourceExt as 'mp4' | 'webm' | 'mkv';
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
          props.audioSettings.sampleRate = 'original';
          props.audioSettings.onlyBitrateKbps = meta.audio.bitrate
            ? Math.round(meta.audio.bitrate / 1000)
            : 0;
          props.videoSettings.audioBitrateKbps = props.audioSettings.onlyBitrateKbps || 0;
        } else {
          props.sourceHasAudio.value = false;
          props.videoSettings.excludeAudio = true;
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.sampleRate = 'original';
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
      props.audioSettings.onlyFormat = 'opus';
      props.audioSettings.onlyBitrateKbps = DEFAULT_AUDIO_BITRATE_KBPS;
      props.audioSettings.channels = 2;
      props.audioSettings.originalSampleRate = null;
      props.audioSettings.originalChannels = null;
      props.audioSettings.sampleRate = 'original';

      try {
        const file = await projectStore.getFileByPath(entry.path);
        if (!file) throw new Error('Failed to access source file');
        const meta = await extractEntryMetadata(entry.path, file);

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
          props.audioSettings.sampleRate = 'original';
          props.audioSettings.onlyBitrateKbps = meta.audio.bitrate
            ? Math.round(meta.audio.bitrate / 1000)
            : 0;
        } else {
          props.audioSettings.originalSampleRate = null;
          props.audioSettings.originalChannels = null;
          props.audioSettings.sampleRate = 'original';
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
        const file = await resolveImageSourceFile(entry.path);
        if (!file) throw new Error('Failed to access source file');

        // Guard against OOM on extremely large images before decoding
        if (file.size > 500 * 1024 * 1024) {
          throw new Error('Image file exceeds 500MB limit');
        }

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
        log.warn('Failed to extract image metadata', err);
        props.imageSettings.width = 0;
        props.imageSettings.height = 0;
        props.imageSettings.aspectRatio = 1;
      }
    }
    props.isExtractingMetadata.value = false;
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
      newExt = resolveAudioOnlyFileExtension(props.audioSettings.onlyFormat);
    } else newExt = props.videoSettings.format;

    const sampleRate =
      props.audioSettings.sampleRate === 'original'
        ? props.audioSettings.originalSampleRate
        : clampPositiveNumber(Number(props.audioSettings.sampleRate), 0);

    const target = getSiblingTarget(entry.path, `${baseName}_converted.${newExt}`);

    const request: ConversionRequest = {
      entry,
      type,
      dirPath: target.dirPath,
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
        fastStart: props.videoSettings.fastStart,
        width: Math.max(1, Math.round(Number(props.videoSettings.width) || DEFAULT_VIDEO_WIDTH)),
        height: Math.max(1, Math.round(Number(props.videoSettings.height) || DEFAULT_VIDEO_HEIGHT)),
        fps: clampPositiveNumber(Number(props.videoSettings.fps), DEFAULT_VIDEO_FPS),
      };
    } else if (type === 'audio') {
      request.audioOnly = {
        codec: props.audioSettings.onlyFormat,
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
    if (props.isConverting.value) return;

    props.isCancelRequested.value = false;
    props.conversionError.value = '';
    props.conversionWarnings.value = [];
    const reportConversionWarning = createGroupedWarningReporter(props.conversionWarnings);

    let createdFileName: string | null = null;
    let createdFilePath: string | null = null;
    let createdDirHandle: FileSystemDirectoryHandle | null = null;
    let dirPath = '';

    try {
      const entry = props.targetEntry.value;
      const request = buildConversionRequest(entry);
      const taskId = createConversionTaskId();
      const target = getSiblingTarget(entry.path, request.newFileName);

      createdFileName = request.newFileName;
      dirPath = request.dirPath;
      createdFilePath = target.filePath;

      const vfs = props.targetVfs.value ?? props.fileManager.vfs;
      const unique = await resolveUniqueFileName(
        (p) => vfs.exists(p),
        createdFilePath,
        createdFileName,
      );
      createdFilePath = unique.filePath;
      createdFileName = unique.fileName;
      request.newFileName = unique.fileName;

      if (request.type === 'video' || request.type === 'audio') {
        const targetHandle = props.targetIsExternal.value
          ? await getWorkspaceFileHandle(createdFilePath, { create: true })
          : await (async () => {
              const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
              if (!dirHandle) return null;

              createdDirHandle = dirHandle;
              return await dirHandle.getFileHandle(request.newFileName, { create: true });
            })();
        if (!targetHandle) throw new Error('Target directory not found');

        const title = t('videoEditor.backgroundTasks.conversionTitle', { fileName: entry.name });
        const controller = new AbortController();
        const bgTaskId = backgroundTasksStore.addTask({
          type: 'conversion',
          title,
          status: 'pending',
          // The terminal status is set by the .catch handler below once the
          // export worker actually rejects with AbortError. We only need to
          // request cancellation here.
          cancel: async () => {
            controller.abort();
            try {
              if (isTauriRuntime()) {
                await nativeCancelMediaTask(taskId);
              } else {
                const { client } = getExportWorkerClient();
                await client.cancelExport(taskId);
              }
            } catch (cancelErr) {
              log.warn('cancelExport failed', cancelErr);
            }
          },
        });

        props.isConverting.value = true;
        props.isModalOpen.value = false;
        if (!isMobileLayout.value) {
          toast.add({
            title: t('videoEditor.fileManager.convert.bgTaskAdded'),
            description: title,
            color: 'neutral',
          });
        }

        const runConversion = async () => {
          if (isTauriRuntime()) {
            const sourceHandle = props.targetIsExternal.value
              ? await getWorkspaceFileHandle(entry.path)
              : await projectStore.getFileHandleByPath(entry.path);
            const sourcePath = getNativeFileHandlePath(sourceHandle);
            const targetPath = getNativeFileHandlePath(targetHandle);
            if (!sourcePath || !targetPath) {
              throw new Error('Could not resolve native file paths for conversion');
            }
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'running');
            await nativeConvertMedia({
              taskId,
              sourcePath,
              targetPath,
              request,
              onWarning: reportConversionWarning,
              onProgress: (progress) => {
                backgroundTasksStore.updateTaskProgress(bgTaskId, progress);
              },
            });
            return;
          }

          await executeMediaConversion({
            request,
            targetHandle,
            taskId,
            backgroundTaskId: bgTaskId,
            isExternal: props.targetIsExternal.value,
            signal: controller.signal,
            isCancelRequested: () => {
              const task = backgroundTasksStore.tasks.find((item) => item.id === bgTaskId);
              return task?.status === 'cancelled';
            },
          });
        };

        runConversion()
          .then(async () => {
            backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
            backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');
            if (props.conversionWarnings.value.length > 0) {
              props.isModalOpen.value = true;
              toast.add({
                title: t('videoEditor.fileManager.convert.completedWithWarnings'),
                description: props.conversionWarnings.value[0],
                color: 'warning',
              });
              return;
            }
            toast.add({
              title: t('videoEditor.fileManager.convert.success'),
              color: 'success',
            });
          })
          .catch(async (err) => {
            await removeCreatedFile({
              dirHandle: createdDirHandle,
              fileName: createdFileName,
              filePath: createdFilePath,
            });
            if (isAbortError(err)) {
              backgroundTasksStore.updateTaskStatus(bgTaskId, 'cancelled');
            } else {
              backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', err.message);
              log.error('Conversion failed', err);
              props.conversionError.value = err instanceof Error ? err.message : String(err);
              props.isModalOpen.value = true;
              toast.add({
                title: t('videoEditor.fileManager.convert.failed'),
                description: err instanceof Error ? err.message : String(err),
                color: 'error',
              });
            }
          })
          .finally(async () => {
            props.isConverting.value = false;
            await (props.targetReloadDirectory.value ?? props.fileManager.reloadDirectory)(dirPath);
            uiStore.notifyFileManagerUpdate();
          });
      } else if (request.type === 'image') {
        // Images convert in foreground
        props.isConverting.value = true;
        const sourceFile = await resolveImageSourceFile(entry.path);
        if (!sourceFile) throw new Error('Failed to access source file');

        try {
          const blob = await convertImageFile({
            file: sourceFile,
            request,
            isCancelRequested: () => props.isCancelRequested.value,
          });
          if (!createdFilePath) throw new Error('Failed to resolve target path');
          await (props.targetVfs.value ?? props.fileManager.vfs).writeFile(createdFilePath, blob);
          toast.add({
            title: t('videoEditor.fileManager.convert.success'),
            color: 'success',
          });
          props.isModalOpen.value = false;
        } catch (err) {
          if (isAbortError(err) || props.isCancelRequested.value) {
            if (createdFilePath) {
              await (props.targetVfs.value ?? props.fileManager.vfs)
                .deleteEntry(createdFilePath)
                .catch(() => {});
            }
          } else {
            const error = err instanceof Error ? err : new Error(String(err));
            props.conversionError.value = error.message;
            toast.add({
              title: t('videoEditor.fileManager.convert.failed'),
              description: error.message,
              color: 'error',
            });
          }
        } finally {
          props.isConverting.value = false;
          await (props.targetReloadDirectory.value ?? props.fileManager.reloadDirectory)(dirPath);
          uiStore.notifyFileManagerUpdate();
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Conversion initiation failed', err);
      props.conversionError.value = error.message;
      props.isModalOpen.value = true;
      toast.add({
        title: t('videoEditor.fileManager.convert.failed'),
        description: error.message,
        color: 'error',
      });
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
