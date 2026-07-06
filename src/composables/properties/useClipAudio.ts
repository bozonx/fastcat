import { computed, ref, type Ref } from 'vue';
import type {
  FixedAnimatableParamPath,
  TimelineClipItem,
  TimelineTrack,
  TimelineDocument,
} from '~/timeline/types';
import {
  CLIP_AUDIO_GAIN_MAX,
  normalizeAudioFadeCurve,
  type AudioFadeCurve,
} from '~/utils/audio/envelope';
import { cloneValue } from '~/utils/clone';

interface UseClipAudioOptions {
  clip: Ref<TimelineClipItem>;
  tracks: Ref<TimelineTrack[] | undefined>;
  mediaMetadataByPath: Ref<Record<string, unknown>>;
  updateAudio: (
    patch: {
      audioGain?: number;
      audioBalance?: number;
      audioFadeInUs?: number;
      audioFadeOutUs?: number;
      audioFadeInCurve?: AudioFadeCurve;
      audioFadeOutCurve?: AudioFadeCurve;
    },
    options?: {
      skipHistory?: boolean;
      saveMode?: 'debounced' | 'immediate' | 'none';
      historyMode?: 'immediate' | 'debounced';
    },
  ) => void;
  pushHistory?: (preState: TimelineDocument, commandType: string, labelKey: string) => void;
  getTimelineDoc?: () => TimelineDocument | null;
  isParamAnimated?: (path: FixedAnimatableParamPath) => boolean;
  onAnimatedParamEdit?: (path: FixedAnimatableParamPath, value: number) => void;
  getAnimatedDisplayValue?: (path: FixedAnimatableParamPath, staticValue: number) => number;
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
    if (track?.kind === 'video' && clip.audioMuted) return false;

    const path = clip.source?.path;
    if (path) {
      const meta = options.mediaMetadataByPath.value[path];
      if (meta && !(meta as Record<string, unknown>).audio) return false;
    }

    return true;
  });

  const canEditAudioBalance = computed(() => {
    return canEditAudioGain.value;
  });

  const audioGain = computed(() => {
    const v = options.clip.value.audioGain;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 1;
    const displayed = options.getAnimatedDisplayValue?.('audio.volume', safe) ?? safe;
    return Math.max(0, Math.min(CLIP_AUDIO_GAIN_MAX, displayed));
  });

  const audioBalance = computed(() => {
    const v = options.clip.value.audioBalance;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    const displayed = options.getAnimatedDisplayValue?.('audio.pan', safe) ?? safe;
    return Math.max(-1, Math.min(1, displayed));
  });

  function tryRecordAnimatedEdit(path: FixedAnimatableParamPath, value: number): boolean {
    if (!options.isParamAnimated?.(path)) return false;
    options.onAnimatedParamEdit?.(path, value);
    return true;
  }

  function updateAudioGain(val: unknown, applyOptions?: { skipHistory?: boolean }) {
    const safe = clampNumber(val, 0, CLIP_AUDIO_GAIN_MAX);
    if (tryRecordAnimatedEdit('audio.volume', safe)) return;
    options.updateAudio({ audioGain: safe }, applyOptions);
  }

  function updateAudioBalance(val: unknown) {
    const safe = clampNumber(val, -1, 1);
    if (tryRecordAnimatedEdit('audio.pan', safe)) return;
    options.updateAudio({ audioBalance: safe });
  }

  const audioFadeInSec = computed(() => {
    const v = options.clip.value.audioFadeInUs;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(0, safe / 1_000_000);
  });

  const audioFadeOutSec = computed(() => {
    const v = options.clip.value.audioFadeOutUs;
    const safe = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return Math.max(0, safe / 1_000_000);
  });

  const audioFadeInMaxSec = computed(() => {
    const oppUs = options.clip.value.audioFadeOutUs;
    const oppSafe = typeof oppUs === 'number' && Number.isFinite(oppUs) ? oppUs : 0;
    return Math.max(
      0,
      (Number(options.clip.value.timelineRange?.durationUs ?? 0) - oppSafe) / 1_000_000,
    );
  });

  const audioFadeOutMaxSec = computed(() => {
    const oppUs = options.clip.value.audioFadeInUs;
    const oppSafe = typeof oppUs === 'number' && Number.isFinite(oppUs) ? oppUs : 0;
    return Math.max(
      0,
      (Number(options.clip.value.timelineRange?.durationUs ?? 0) - oppSafe) / 1_000_000,
    );
  });

  const audioFadeInCurve = computed<AudioFadeCurve>(() => {
    return normalizeAudioFadeCurve(options.clip.value.audioFadeInCurve);
  });

  const audioFadeOutCurve = computed<AudioFadeCurve>(() => {
    return normalizeAudioFadeCurve(options.clip.value.audioFadeOutCurve);
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

  const docBeforeDrag = ref<TimelineDocument | null>(null);

  function onVolumeDragStart() {
    if (options.getTimelineDoc) {
      docBeforeDrag.value = cloneValue(options.getTimelineDoc());
    }
  }

  function onVolumeDragEnd() {
    if (docBeforeDrag.value && options.pushHistory) {
      options.pushHistory(
        docBeforeDrag.value,
        'update_clip_properties',
        'videoEditor.fileManager.history.entries.updateClipGain',
      );
    }
    docBeforeDrag.value = null;
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
    onVolumeDragStart,
    onVolumeDragEnd,
  };
}
