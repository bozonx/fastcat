import { ref } from 'vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkAudioCodecSupport,
  checkVideoCodecSupport,
} from '~/utils/webcodecs';
import { isTauriRuntime } from '~/utils/runtime';

export interface AudioCodecSupport {
  aac: boolean;
  opus: boolean;
  flac: boolean;
  pcm: boolean;
  mp3: boolean;
}

export function useExportCodecs() {
  const isTauri = isTauriRuntime();
  const videoCodecSupport = ref<Record<string, boolean>>({});
  const audioCodecSupport = ref<AudioCodecSupport>({
    aac: true,
    opus: true,
    flac: isTauri,
    pcm: true,
    mp3: isTauri,
  });
  const isLoadingCodecSupport = ref(false);

  async function loadCodecSupport() {
    if (isLoadingCodecSupport.value) return;
    isLoadingCodecSupport.value = true;
    try {
      if (isTauri) {
        videoCodecSupport.value = Object.fromEntries(
          BASE_VIDEO_CODEC_OPTIONS.map((option) => [option.value, true]),
        );
        audioCodecSupport.value = {
          aac: true,
          opus: true,
          flac: true,
          pcm: true,
          mp3: true,
        };
        return;
      }
      const [videoSupport, audioSupport] = await Promise.all([
        checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS),
        (async (): Promise<AudioCodecSupport> => {
          try {
            const { canEncodeAudio } = await import('mediabunny');
            const [aac, opus, flac, mp3] = await Promise.all([
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
              canEncodeAudio('flac', {
                numberOfChannels: 2,
                sampleRate: 48000,
              }),
              canEncodeAudio('mp3', {
                numberOfChannels: 2,
                sampleRate: 48000,
                bitrate: 128_000,
              }).catch(() => false),
            ]);
            return {
              aac: !!aac,
              opus: !!opus,
              flac: isTauri && !!flac,
              pcm: true,
              mp3: isTauri && !!mp3,
            };
          } catch {
            const support = await checkAudioCodecSupport([
              { value: 'mp4a.40.2', label: 'AAC' },
              { value: 'opus', label: 'Opus' },
              { value: 'flac', label: 'FLAC' },
              { value: 'mp3', label: 'MP3' },
            ]);
            return {
              aac: support['mp4a.40.2'] !== false,
              opus: support['opus'] !== false,
              flac: isTauri && support['flac'] !== false,
              pcm: true,
              mp3: isTauri && support['mp3'] === true,
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
