import { computed, ref, watch, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { ClipTransition } from '~/timeline/types';

export interface ClipTransitionUpdatePayload {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: ClipTransition | null;
}

interface UseClipTransitionPanelOptions {
  edge: Ref<'in' | 'out'>;
  trackId: Ref<string>;
  itemId: Ref<string>;
  transition: Ref<ClipTransition | undefined>;
  maxDuration?: Ref<number | undefined>;
  onUpdate: (payload: ClipTransitionUpdatePayload) => void;
  debounceMs?: number;
}

export function useClipTransitionPanel(options: UseClipTransitionPanelOptions) {
  const durationSec = ref(options.transition.value ? options.transition.value.durationUs / 1_000_000 : 0.5);
  const selectedType = ref(options.transition.value?.type ?? 'dissolve');
  const selectedMode = ref<'blend' | 'composite'>(options.transition.value?.mode ?? 'blend');
  const selectedCurve = ref<'linear' | 'bezier'>(options.transition.value?.curve ?? 'linear');

  let isSyncingFromProps = false;

  watch(
    options.transition,
    (t) => {
      isSyncingFromProps = true;
      if (t) {
        selectedType.value = t.type;
        durationSec.value = t.durationUs / 1_000_000;
        selectedMode.value = t.mode ?? 'blend';
        selectedCurve.value = t.curve ?? 'linear';
      }
      void Promise.resolve().then(() => {
        isSyncingFromProps = false;
      });
    },
  );

  const edgeIcon = computed(() =>
    options.edge.value === 'in'
      ? 'i-heroicons-arrow-left-end-on-rectangle'
      : 'i-heroicons-arrow-right-end-on-rectangle',
  );

  function emitUpdate() {
    if (isSyncingFromProps) return;

    options.onUpdate({
      trackId: options.trackId.value,
      itemId: options.itemId.value,
      edge: options.edge.value,
      transition: {
        type: selectedType.value,
        durationUs: Math.round(durationSec.value * 1_000_000),
        mode: selectedMode.value,
        curve: selectedCurve.value,
      },
    });
  }

  const emitDebouncedDuration = useDebounceFn(emitUpdate, options.debounceMs ?? 80);

  watch(selectedType, emitUpdate);
  watch(selectedMode, emitUpdate);
  watch(selectedCurve, emitUpdate);
  watch(durationSec, emitDebouncedDuration);

  function remove() {
    options.onUpdate({
      trackId: options.trackId.value,
      itemId: options.itemId.value,
      edge: options.edge.value,
      transition: null,
    });
  }

  const durationMin = 0.1;
  const defaultDurationMax = 3;
  const durationMax = computed(() => {
    return options.maxDuration?.value ?? defaultDurationMax;
  });
  const durationStep = 0.05;

  return {
    durationMax,
    durationMin,
    durationSec,
    durationStep,
    edgeIcon,
    remove,
    selectedCurve,
    selectedMode,
    selectedType,
  };
}
