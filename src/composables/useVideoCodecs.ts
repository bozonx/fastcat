import { ref, computed, onMounted } from 'vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
  type VideoCodecOptionResolved,
} from '~/utils/webcodecs';

export function useVideoCodecs() {
  const videoCodecSupport = ref<Record<string, boolean>>({});
  const isLoadingCodecSupport = ref(false);

  const videoCodecOptions = computed<VideoCodecOptionResolved[]>(() =>
    resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
  );

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    } finally {
      isLoadingCodecSupport.value = false;
    }
  }

  onMounted(() => {
    loadCodecSupport();
  });

  return {
    videoCodecSupport,
    isLoadingCodecSupport,
    videoCodecOptions,
    loadCodecSupport,
  };
}
