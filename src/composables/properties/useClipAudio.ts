import { computed, type Ref } from 'vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { normalizeAudioFadeCurve, type AudioFadeCurve } from '~/utils/audio/envelope';

interface UseClipAudioOptions {
  clip: Ref<TimelineClipItem>;
  tracks: Ref<TimelineTrack[] | undefined>;
  mediaMetadataByPath: Ref<Record<string, any>>;
  updateAudio: (patch: {
    audioGain?: number;
    audioBalance?: number;
    audioFadeInUs?: number;
    audioFadeOutUs?: number;
    audioFadeInCurve?: AudioFadeCurve;
    audioFadeOutCurve?: AudioFadeCurve;
  }) => void;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function useClipAudio(options: UseClipAudioOptions) {
  const selectedClipTrack = computed<TimelineTrack | null>(() => {
    const id = options.clip.value.trackId;
    return options.tracks.value?.find((t) => t.id === id) ?? null;
  });

  const canEditAudioFades = computed(() => {
    const clipType = options.clip.value.clipType;
    return clipType === 'media' || clipType === 'timeline';
  });

  const canEditAudioGain = computed(() => {
    if (!canEditAudioFades.value) return false;

    const clip = options.clip.value;
    const track = options.tracks.value?.find((t) => t.id === clip.trackId);
    if (track?.kind === 'video' && (clip as any).audioFromVideoDisabled) return false;

    const path = (clip as any).source?.path as string | undefined;
    if (path) {
      const meta = options.mediaMetadataByPath.value[path];
      if (meta && !meta.audio) return false;
    }

    return true;
  });

  const canEditAudioBalance = computed(() => {
    return canEditAudioGain.value;
  });

  const audioGain = computed(() => {
    const v = (options.clip.value as any)?.audioGain;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 1;
    return Math.max(0, Math.min(2, safe));
  });

  const audioBalance = computed(() => {
    const v = (options.clip.value as any)?.audioBalance;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(-1, Math.min(1, safe));
  });

  function updateAudioGain(val: unknown) {
    const safe = clampNumber(val, 0, 2);
    options.updateAudio({ audioGain: safe });
  }

  function updateAudioBalance(val: unknown) {
    const safe = clampNumber(val, -1, 1);
    options.updateAudio({ audioBalance: safe });
  }

  const clipDurationSec = computed(() => {
    return Math.max(0, Number(options.clip.value.timelineRange?.durationUs ?? 0) / 1_000_000);
  });

  const audioFadeInSec = computed(() => {
    const v = (options.clip.value as any)?.audioFadeInUs;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(0, safe / 1_000_000);
  });

  const audioFadeOutSec = computed(() => {
    const v = (options.clip.value as any)?.audioFadeOutUs;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(0, safe / 1_000_000);
  });

  const audioFadeInMaxSec = computed(() => {
    const oppUs = (options.clip.value as any)?.audioFadeOutUs;
    const oppSafe = typeof oppUs === 'number' && Number.isFinite(oppUs) ? oppUs : 0;
    return Math.max(
      0,
      (Number(options.clip.value.timelineRange?.durationUs ?? 0) - oppSafe) / 1_000_000,
    );
  });

  const audioFadeOutMaxSec = computed(() => {
    const oppUs = (options.clip.value as any)?.audioFadeInUs;
    const oppSafe = typeof oppUs === 'number' && Number.isFinite(oppUs) ? oppUs : 0;
    return Math.max(
      0,
      (Number(options.clip.value.timelineRange?.durationUs ?? 0) - oppSafe) / 1_000_000,
    );
  });

  const audioFadeInCurve = computed<AudioFadeCurve>(() => {
    return normalizeAudioFadeCurve((options.clip.value as any)?.audioFadeInCurve);
  });

  const audioFadeOutCurve = computed<AudioFadeCurve>(() => {
    return normalizeAudioFadeCurve((options.clip.value as any)?.audioFadeOutCurve);
  });

  function updateAudioFadeInSec(val: number) {
    const safeSec = clampNumber(val, 0, audioFadeInMaxSec.value);
    options.updateAudio({ audioFadeInUs: Math.round(safeSec * 1_000_000) });
  }

  function updateAudioFadeOutSec(val: number) {
    const safeSec = clampNumber(val, 0, audioFadeOutMaxSec.value);
    options.updateAudio({ audioFadeOutUs: Math.round(safeSec * 1_000_000) });
  }

  function updateAudioFadeInCurve(val: unknown) {
    options.updateAudio({ audioFadeInCurve: normalizeAudioFadeCurve(val) });
  }

  function updateAudioFadeOutCurve(val: unknown) {
    options.updateAudio({ audioFadeOutCurve: normalizeAudioFadeCurve(val) });
  }

  return {
    audioBalance,
    audioFadeInCurve,
    audioFadeInMaxSec,
    audioFadeInSec,
    audioFadeOutCurve,
    audioFadeOutMaxSec,
    audioFadeOutSec,
    audioGain,
    canEditAudioBalance,
    canEditAudioFades,
    canEditAudioGain,
    selectedClipTrack,
    updateAudioBalance,
    updateAudioFadeInCurve,
    updateAudioFadeInSec,
    updateAudioFadeOutCurve,
    updateAudioFadeOutSec,
    updateAudioGain,
  };
}
