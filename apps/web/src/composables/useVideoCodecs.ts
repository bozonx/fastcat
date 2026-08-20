import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed, onMounted } from 'vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
  type VideoCodecOptionResolved,
} from '~/utils/webcodecs';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('useVideoCodecs');

export function useVideoCodecs() {
  const videoCodecSupport = ref<Record<string, boolean>>({});
  const isLoadingCodecSupport = ref(false);
  const isTauri = isTauriRuntime();

  const videoCodecOptions = computed<VideoCodecOptionResolved[]>(() =>
    resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
  );

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      if (isTauri) {
        // Tauri uses native ffmpeg-based encoding, so all configured video codecs are supported.
        videoCodecSupport.value = Object.fromEntries(
          BASE_VIDEO_CODEC_OPTIONS.map((option) => [option.value, true]),
        );
        return;
      }
      videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS);
    } catch (error) {
      log.warn('Failed to check video codec support', error);
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
