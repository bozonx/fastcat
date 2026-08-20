import { computed, onMounted, toValue, type MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';
import { AUDIO_EXPORT_CODEC_OPTIONS, type AudioCodecOptionResolved } from '~/utils/webcodecs';
import { isTauriRuntime } from '~/utils/runtime';
import { useExportCodecs } from './useExportCodecs';

export interface UseAudioCodecOptionsParams {
  /** Output container format. When provided and `disableByFormat` is true, incompatible codecs are disabled. */
  format?: MaybeRefOrGetter<'mp4' | 'webm' | 'mkv' | string | undefined>;
  /** If true, disable codecs that are incompatible with the provided container format. */
  disableByFormat?: boolean;
  /** If true, replace AAC/Opus labels with i18n keys. */
  relabel?: boolean;
  /** If true (default), load codec support info on mount. */
  loadOnMount?: boolean;
}

/**
 * Shared audio codec option list used by export, conversion and encoding settings.
 * Encapsulates Tauri vs web filtering, WebCodecs support checks, container-format
 * incompatibilities and i18n relabeling.
 */
export function useAudioCodecOptions(params: UseAudioCodecOptionsParams = {}) {
  const { format, disableByFormat = false, relabel = false, loadOnMount = true } = params;

  const { t } = useI18n();
  const { audioCodecSupport, loadCodecSupport, isLoadingCodecSupport } = useExportCodecs();

  if (loadOnMount) {
    onMounted(() => {
      loadCodecSupport();
    });
  }

  const audioCodecOptions = computed<AudioCodecOptionResolved[]>(() => {
    const outputFormat = toValue(format);
    const isTauri = isTauriRuntime();

    const filtered = AUDIO_EXPORT_CODEC_OPTIONS.filter((opt) => {
      if (!isTauri && (opt.value === 'flac' || opt.value === 'mp3')) {
        return false;
      }
      return true;
    });

    return filtered.map((opt) => {
      let disabled = false;

      if (disableByFormat && outputFormat) {
        if (outputFormat === 'webm' && opt.value !== 'opus') {
          disabled = true;
        } else if (outputFormat === 'mp4' && (opt.value === 'flac' || opt.value === 'pcm')) {
          disabled = true;
        }
      }

      const isSupported =
        audioCodecSupport.value[opt.value as keyof typeof audioCodecSupport.value] !== false;

      return {
        value: opt.value,
        label:
          relabel && (opt.value === 'aac' || opt.value === 'opus')
            ? t(`videoEditor.export.codec.${opt.value}` as const, opt.label)
            : opt.label,
        disabled: disabled || !isSupported,
      } satisfies AudioCodecOptionResolved;
    });
  });

  return {
    audioCodecOptions,
    loadCodecSupport,
    isLoadingCodecSupport,
  };
}
