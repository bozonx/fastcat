import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';

export function useFileConversion() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const fileManager = useFileManager();
  const toast = useToast();

  const isModalOpen = ref(false);
  const targetEntry = ref<FsEntry | null>(null);

  const mediaType = computed(() => {
    if (!targetEntry.value) return null;
    return getMediaTypeFromFilename(targetEntry.value.name);
  });

  const isConverting = ref(false);
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

  // Audio Settings
  const audioOnlyFormat = ref<'webm' | 'mp4'>('webm'); // usually webm for opus
  const audioOnlyCodec = ref<'opus' | 'aac'>('opus');
  const audioOnlyBitrateKbps = ref(128);
  const audioChannels = ref<'stereo' | 'mono'>('stereo');
  const audioSampleRate = ref(48000);

  // Image Settings
  const imageQuality = ref(80); // 0-100

  function openConversionModal(entry: FsEntry) {
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
    } else if (type === 'audio') {
      audioOnlyCodec.value = 'opus';
      audioOnlyFormat.value = 'webm';
      audioOnlyBitrateKbps.value = 128;
      audioChannels.value = 'stereo';
      audioSampleRate.value = 48000;
    } else if (type === 'image') {
      imageQuality.value = 80;
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
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context');
    ctx.drawImage(bitmap, 0, 0);

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
        audioCodec: audioCodec.value,
        width: meta.video?.width || 1920,
        height: meta.video?.height || 1080,
        fps: meta.video?.fps || 30,
        bitrateMode: bitrateMode.value,
        keyframeIntervalSec: keyframeIntervalSec.value,
        exportAlpha: false,
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
      exportOptions = {
        format: audioOnlyFormat.value,
        videoCodec: 'none',
        audioBitrate: audioOnlyBitrateKbps.value * 1000,
        audio: true,
        audioCodec: audioOnlyCodec.value,
        width: 2,
        height: 2,
        fps: 30,
        audioChannels: audioChannels.value,
        audioSampleRate: audioSampleRate.value,
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

      toast.add({
        title: t('videoEditor.fileManager.convert.success', 'File converted successfully'),
        color: 'success',
      });

      await fileManager.loadProjectDirectory();
      isModalOpen.value = false;
    } catch (err: any) {
      console.error('Conversion failed', err);
      conversionError.value = err.message || 'Failed to convert file';
    } finally {
      isConverting.value = false;
    }
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
    audioOnlyFormat,
    audioOnlyCodec,
    audioOnlyBitrateKbps,
    audioChannels,
    audioSampleRate,
    imageQuality,
    openConversionModal,
    startConversion,
  };
}
