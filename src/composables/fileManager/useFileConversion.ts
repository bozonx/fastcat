import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';

// Module-level singleton state so all components share the same modal instance.
const isModalOpen = ref(false);
const targetEntry = ref<FsEntry | null>(null);

const mediaType = computed(() => {
  if (!targetEntry.value) return null;
  return getMediaTypeFromFilename(targetEntry.value.name);
});

const isConverting = ref(false);
const isCancelRequested = ref(false);
const conversionProgress = ref(0);
const conversionError = ref<string | null>(null);
const conversionPhase = ref<'encoding' | 'saving' | null>(null);

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
const originalAudioSampleRate = ref<number | null>(null);

// Image Settings
const imageQuality = ref(80); // 0-100
const imageWidth = ref(0);
const imageHeight = ref(0);
const isImageResolutionLinked = ref(true);
const imageAspectRatio = ref(1);

export function useFileConversion() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const fileManager = useFileManager();
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

  async function openConversionModal(entry: FsEntry) {
    targetEntry.value = entry;
    const type = mediaType.value;

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
        const fileHandle = entry.handle as FileSystemFileHandle;
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(fileHandle);

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
        const fileHandle = entry.handle as FileSystemFileHandle;
        const { client } = getExportWorkerClient();
        const meta = await client.extractMetadata(fileHandle);
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
        const fileHandle = entry.handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const bitmap = await createImageBitmap(file);
        imageWidth.value = bitmap.width;
        imageHeight.value = bitmap.height;
        imageAspectRatio.value = bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
      } catch {
        imageWidth.value = 0;
        imageHeight.value = 0;
        imageAspectRatio.value = 1;
      }
    }

    isConverting.value = false;
    conversionProgress.value = 0;
    conversionError.value = null;
    isModalOpen.value = true;
  }

  async function convertImage(
    fileHandle: FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
  ) {
    const file = await fileHandle.getFile();
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');

    const targetWidth = Math.max(1, Math.round(Number(imageWidth.value) || bitmap.width));
    const targetHeight = Math.max(1, Math.round(Number(imageHeight.value) || bitmap.height));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', imageQuality.value / 100);
    });

    if (!blob) throw new Error('Failed to create webp blob');

    const writable = await targetHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function convertVideoAudio(
    fileHandle: FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
  ) {
    if (!targetEntry.value || !targetEntry.value.path) return;
    const { client } = getExportWorkerClient();

    setExportHostApi({
      getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
      onExportProgress: (progress) => {
        conversionProgress.value = progress / 100;
      },
      onExportPhase: (phase) => {
        conversionPhase.value = phase;
      },
      onExportWarning: (message) => {
        console.warn(message);
      },
    });

    const meta = await client.extractMetadata(fileHandle);
    const durationUs = Math.round((meta.duration || 0) * 1_000_000);
    if (!durationUs && mediaType.value === 'video') throw new Error('Invalid media duration');

    const isVideo = mediaType.value === 'video';

    let exportOptions: any = {};
    let videoPayload: any[] = [];
    let audioPayload: any[] = [];

    if (isVideo) {
      exportOptions = {
        format: videoFormat.value,
        videoCodec: videoCodec.value,
        bitrate: videoBitrateMbps.value * 1_000_000,
        audioBitrate: audioBitrateKbps.value * 1000,
        audio: !excludeAudio.value,
        audioCodec: videoFormat.value === 'mp4' ? 'aac' : 'opus',
        width: Math.max(1, Math.round(Number(videoWidth.value) || meta.video?.width || 1920)),
        height: Math.max(1, Math.round(Number(videoHeight.value) || meta.video?.height || 1080)),
        fps: clampPositiveNumber(Number(videoFps.value) || Number(meta.video?.fps), 30),
        bitrateMode: bitrateMode.value,
        keyframeIntervalSec: keyframeIntervalSec.value,
        exportAlpha: false,
        audioChannels: audioChannels.value,
        audioSampleRate:
          audioSampleRate.value === 0 && originalAudioSampleRate.value !== null
            ? originalAudioSampleRate.value
            : audioSampleRate.value || undefined,
      };

      videoPayload = [
        {
          kind: 'clip',
          id: 'convert_video',
          layer: 0,
          source: { path: targetEntry.value.path },
          timelineRange: { startUs: 0, durationUs },
          sourceRange: { startUs: 0, durationUs },
        },
      ];

      if (!excludeAudio.value && meta.audio) {
        audioPayload = [
          {
            kind: 'clip',
            id: 'convert_audio',
            layer: 0,
            source: { path: targetEntry.value.path },
            timelineRange: { startUs: 0, durationUs },
            sourceRange: { startUs: 0, durationUs },
            audioGain: 1,
          },
        ];
      }
    } else {
      // Audio only
      const codec = audioOnlyCodec.value;
      exportOptions = {
        format: resolveAudioOnlyContainerFormat(codec),
        videoCodec: 'none',
        // mediabunny CanvasSource requires bitrate to be a positive integer or quality.
        // In audio-only mode we still instantiate a video track (tiny canvas), so set valid parameters.
        bitrate: 100_000,
        audioBitrate: audioOnlyBitrateKbps.value * 1000,
        audio: true,
        audioCodec: codec,
        width: 16,
        height: 16,
        fps: 1,
        audioChannels: audioChannels.value,
        audioSampleRate:
          audioSampleRate.value === 0 && originalAudioSampleRate.value !== null
            ? originalAudioSampleRate.value
            : audioSampleRate.value || undefined,
      };

      if (meta.audio) {
        audioPayload = [
          {
            kind: 'clip',
            id: 'convert_audio',
            layer: 0,
            source: { path: targetEntry.value.path },
            timelineRange: { startUs: 0, durationUs },
            sourceRange: { startUs: 0, durationUs },
            audioGain: 1,
          },
        ];
      }
    }

    await (client as any).exportTimeline(targetHandle, exportOptions, videoPayload, audioPayload);
  }

  async function startConversion() {
    if (!targetEntry.value || isConverting.value) return;

    isConverting.value = true;
    isCancelRequested.value = false;
    conversionError.value = null;
    conversionProgress.value = 0;

    try {
      const entry = targetEntry.value;
      const fileHandle = entry.handle as FileSystemFileHandle;
      const type = mediaType.value;

      const baseName = entry.name.replace(/\.[^.]+$/, '');
      let newExt = '';
      if (type === 'image') newExt = 'webp';
      else if (type === 'audio') newExt = audioOnlyFormat.value;
      else if (type === 'video') newExt = videoFormat.value;

      const newFileName = `${baseName}_converted.${newExt}`;

      let dirHandle: FileSystemDirectoryHandle;

      if (entry.parentHandle) {
        dirHandle = entry.parentHandle;
      } else {
        const root = await fileManager.getProjectRootDirHandle();
        if (!root) throw new Error('Root directory not found');

        const parts = (entry.path || '').split('/').slice(0, -1);
        let current = root;
        for (const p of parts) {
          if (!p) continue;
          current = await current.getDirectoryHandle(p);
        }
        dirHandle = current;
      }

      const targetHandle = await dirHandle.getFileHandle(newFileName, { create: true });

      if (type === 'image') {
        await convertImage(fileHandle, targetHandle);
      } else {
        await convertVideoAudio(fileHandle, targetHandle);
      }

      if (isCancelRequested.value) {
        // Delete the partially created file
        try {
          await dirHandle.removeEntry(newFileName);
        } catch {
          // Ignore cleanup errors
        }
        toast.add({
          title: t('videoEditor.fileManager.convert.cancelled', 'Conversion cancelled'),
          color: 'neutral',
        });
        isModalOpen.value = false;
        isConverting.value = false;
      }

      toast.add({
        title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
        color: 'success',
      });

      await fileManager.loadProjectDirectory();
      isModalOpen.value = false;
    } catch (err: any) {
      console.error('Conversion failed', err);
      if (isCancelRequested.value) {
        toast.add({
          title: t('videoEditor.fileManager.convert.cancelled', 'Conversion cancelled'),
          color: 'neutral',
        });
        isModalOpen.value = false;
      } else {
        conversionError.value = err.message || 'Failed to convert file';
      }
    } finally {
      isConverting.value = false;
    }
  }

  async function cancelConversion() {
    if (!isConverting.value) return;

    const client = await getExportWorkerClient();
    if (client && typeof (client as any).cancelExport === 'function') {
      await (client as any).cancelExport();
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
