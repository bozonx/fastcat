import { ref } from 'vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkAudioCodecSupport,
  checkVideoCodecSupport,
} from '~/utils/webcodecs';

export function useExportCodecs() {
  const videoCodecSupport = ref<Record<string, boolean>>({});
  const isLoadingCodecSupport = ref(false);

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      const [videoSupport, audioSupport] = await Promise.all([
        checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS),
        (async () => {
          try {
            const { canEncodeAudio } = await import('mediabunny');
            const [aac, opus] = await Promise.all([
              canEncodeAudio('aac', {
                numberOfChannels: 2,
                sampleRate: 48000,
                bitrate: 128_000,
              }),
              canEncodeAudio('opus', {
                numberOfChannels: 2,
                sampleRate: 48000,
                bitrate: 128_000,
              }),
            ]);
            return { aac: !!aac, opus: !!opus } as const;
          } catch {
            const support = await checkAudioCodecSupport([
              { value: 'mp4a.40.2', label: 'AAC' },
              { value: 'opus', label: 'Opus' },
            ]);
            return {
              aac: support['mp4a.40.2'] !== false,
              opus: support['opus'] !== false,
            } as const;
          }
        })(),
      ]);

      videoCodecSupport.value = videoSupport;
    } finally {
      isLoadingCodecSupport.value = false;
    }
  }

  return {
    videoCodecSupport,
    isLoadingCodecSupport,
    loadCodecSupport,
  };
}
