import { ref, computed } from 'vue';
import { getExt } from '../filenameUtils';

export function useExportConfig() {
  const outputFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4');
  const videoCodec = ref('avc1.640032');
  const bitrateMbps = ref<number>(5);
  const excludeAudio = ref(false);
  const audioCodec = ref<'aac' | 'opus'>('aac');
  const audioBitrateKbps = ref<number>(128);
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
  const metadataTitle = ref<string>('');
  const metadataDescription = ref<string>('');
  const metadataAuthor = ref<string>('');
  const metadataTags = ref<string>('');

  const ext = computed(() => getExt(outputFormat.value));

  const bitrateBps = computed(() => {
    const value = Number(bitrateMbps.value);
    if (!Number.isFinite(value)) return 5_000_000;
    const clamped = Math.min(200, Math.max(0.2, value));
    return Math.round(clamped * 1_000_000);
  });

  const normalizedExportWidth = computed(() => {
    const value = Number(exportWidth.value);
    if (!Number.isFinite(value) || value <= 0) return 1920;
    return Math.round(value);
  });

  const normalizedExportHeight = computed(() => {
    const value = Number(exportHeight.value);
    if (!Number.isFinite(value) || value <= 0) return 1080;
    return Math.round(value);
  });

  const normalizedExportFps = computed(() => {
    const value = Number(exportFps.value);
    if (!Number.isFinite(value) || value <= 0) return 30;
    return Math.round(Math.min(240, Math.max(1, value)));
  });

  return {
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
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
    metadataTitle,
    metadataDescription,
    metadataAuthor,
    metadataTags,
    ext,
    bitrateBps,
    normalizedExportWidth,
    normalizedExportHeight,
    normalizedExportFps,
  };
}
