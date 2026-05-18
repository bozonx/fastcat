import { ref } from 'vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkAudioCodecSupport,
  checkVideoCodecSupport,
} from '~/utils/webcodecs';

export interface AudioCodecSupport {
  aac: boolean;
  opus: boolean;
}

export function useExportCodecs() {
  const videoCodecSupport = ref<Record<string, boolean>>({});
  const audioCodecSupport = ref<AudioCodecSupport>({ aac: true, opus: true });
  const isLoadingCodecSupport = ref(false);

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      const [videoSupport, audioSupport] = await Promise.all([
        checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS),
        (async (): Promise<AudioCodecSupport> => {
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
            return { aac: !!aac, opus: !!opus };
          } catch {
            const support = await checkAudioCodecSupport([
              { value: 'mp4a.40.2', label: 'AAC' },
              { value: 'opus', label: 'Opus' },
            ]);
            return {
              aac: support['mp4a.40.2'] !== false,
              opus: support['opus'] !== false,
            };
          }
        })(),
      ]);

      videoCodecSupport.value = videoSupport;
      audioCodecSupport.value = audioSupport;
    } finally {
      isLoadingCodecSupport.value = false;
    }
  }

  return {
    videoCodecSupport,
    audioCodecSupport,
    isLoadingCodecSupport,
    loadCodecSupport,
  };
}
