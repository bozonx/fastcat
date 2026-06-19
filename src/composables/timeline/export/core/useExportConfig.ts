import { ref, computed, watch } from 'vue';
import { getExt } from '../filenameUtils';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { createTimelineFormatFromProjectDefaults } from '~/timeline/format';

export function useExportConfig() {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();

  const exportType = ref<'video' | 'audio'>('video');
  const outputFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4');
  const videoCodec = ref('avc1.640032');
  const bitrateMbps = ref<number>(5);
  const excludeAudio = ref(false);
  const audioCodec = ref<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'>('aac');
  const audioBitrateKbps = ref<number>(128);
  const audioChannels = ref<number>(2);
  const audioSampleRate = ref<number>(48000);
  const exportWidth = ref<number>(1920);
  const exportHeight = ref<number>(1080);
  const exportFps = ref<number>(30);
  const resolutionFormat = ref<string>('1080p');
  const orientation = ref<'landscape' | 'portrait'>('landscape');
  const aspectRatio = ref<string>('16:9');
  const isCustomResolution = ref<boolean>(false);

  const bitrateMode = ref<'constant' | 'variable'>('variable');
  const keyframeIntervalSec = ref<number>(2);
  const exportAlpha = ref<boolean>(false);
  const fastStart = ref<boolean>(true);
  const includeMetadata = ref<boolean>(false);
  const metadataTitle = ref<string>('');
  const metadataDescription = ref<string>('');
  const metadataAuthor = ref<string>('');
  const metadataTags = ref<string>('');

  const matchTimeline = ref<boolean>(true);
  const customWidth = ref<number>(1920);
  const customHeight = ref<number>(1080);
  const customFps = ref<number>(30);
  const customAudioSampleRate = ref<number>(48000);

  watch(
    [() => timelineStore.timelineFormat, matchTimeline],
    ([format, match]) => {
      if (match) {
        const fmt =
          format ?? createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project);
        exportWidth.value = fmt.width;
        exportHeight.value = fmt.height;
        exportFps.value = fmt.fps;
        resolutionFormat.value = fmt.resolutionFormat;
        orientation.value = fmt.orientation;
        aspectRatio.value = fmt.aspectRatio;
        isCustomResolution.value = fmt.isCustomResolution;
        audioSampleRate.value = fmt.sampleRate;
      } else {
        exportWidth.value = customWidth.value;
        exportHeight.value = customHeight.value;
        exportFps.value = customFps.value;
        audioSampleRate.value = customAudioSampleRate.value;
      }
    },
    { immediate: true, deep: true },
  );

  watch([exportWidth, exportHeight, exportFps, audioSampleRate], ([w, h, f, s]) => {
    if (!matchTimeline.value) {
      customWidth.value = w;
      customHeight.value = h;
      customFps.value = f;
      customAudioSampleRate.value = s;
    }
  });

  const ext = computed(() => {
    if (exportType.value === 'audio') {
      if (audioCodec.value === 'opus') return 'opus';
      if (audioCodec.value === 'flac') return 'flac';
      if (audioCodec.value === 'pcm') return 'wav';
      if (audioCodec.value === 'mp3') return 'mp3';
      return 'aac';
    }
    return getExt(outputFormat.value);
  });

  const bitrateBps = computed(() => {
    const value = Number(bitrateMbps.value);
    if (!Number.isFinite(value)) return 5_000_000;
    const clamped = Math.min(200, Math.max(0.2, value));
    return Math.round(clamped * 1_000_000);
  });

  const audioBitrateBps = computed(() => {
    const value = Number(audioBitrateKbps.value);
    if (!Number.isFinite(value)) return 128_000;
    const clamped = Math.min(512, Math.max(8, value));
    return Math.round(clamped * 1000);
  });

  const normalizedExportWidth = computed(() => {
    const value = Number(exportWidth.value);
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.max(2, Math.round(value / 2) * 2);
  });

  const normalizedExportHeight = computed(() => {
    const value = Number(exportHeight.value);
    if (!Number.isFinite(value) || value <= 0) return 1080;
    return Math.max(2, Math.round(value / 2) * 2);
  });

  const normalizedExportFps = computed(() => {
    const value = Number(exportFps.value);
    if (!Number.isFinite(value) || value <= 0) return 30;
    return Math.min(240, Math.max(1, value));
  });

  return {
    exportType,
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    audioChannels,
    audioSampleRate,
    exportWidth,
    exportHeight,
    exportFps,
    resolutionFormat,
    orientation,
    aspectRatio,
    isCustomResolution,
    bitrateMode,
    keyframeIntervalSec,
    exportAlpha,
    fastStart,
    includeMetadata,
    metadataTitle,
    metadataDescription,
    metadataAuthor,
    metadataTags,
    matchTimeline,
    customWidth,
    customHeight,
    customFps,
    customAudioSampleRate,
    ext,
    bitrateBps,
    audioBitrateBps,
    normalizedExportWidth,
    normalizedExportHeight,
    normalizedExportFps,
  };
}
