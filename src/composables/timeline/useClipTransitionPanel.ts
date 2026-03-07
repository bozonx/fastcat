import { computed, ref, watch, type Ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { ClipTransition } from '~/timeline/types';
import {
  DEFAULT_TRANSITION_CURVE,
  DEFAULT_TRANSITION_MODE,
  getTransitionManifest,
  normalizeTransitionParams,
} from '~/transitions';

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

function shallowEqualParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function useClipTransitionPanel(options: UseClipTransitionPanelOptions) {
  const durationSec = ref(
    options.transition.value ? options.transition.value.durationUs / 1_000_000 : 0.5,
  );
  const selectedType = ref(options.transition.value?.type ?? 'dissolve');
  const selectedMode = ref<'blend' | 'blend_previous' | 'composite'>(
    options.transition.value?.mode ?? DEFAULT_TRANSITION_MODE,
  );
  const selectedCurve = ref<'linear' | 'bezier'>(
    options.transition.value?.curve ?? DEFAULT_TRANSITION_CURVE,
  );
  const selectedParams = ref<Record<string, unknown>>(
    (normalizeTransitionParams(
      options.transition.value?.type ?? 'dissolve',
      options.transition.value?.params,
    ) as Record<string, unknown> | undefined) ?? {},
  );

  let syncGeneration = 0;

  watch(options.transition, (t) => {
    const gen = ++syncGeneration;
    if (t) {
      selectedType.value = t.type;
      durationSec.value = t.durationUs / 1_000_000;
      selectedMode.value = t.mode ?? DEFAULT_TRANSITION_MODE;
      selectedCurve.value = t.curve ?? DEFAULT_TRANSITION_CURVE;
      const incomingParams =
        (normalizeTransitionParams(t.type, t.params) as Record<string, unknown> | undefined) ?? {};
      if (!shallowEqualParams(selectedParams.value, incomingParams)) {
        selectedParams.value = incomingParams;
      }
    } else {
      selectedType.value = 'dissolve';
      durationSec.value = 0.5;
      selectedMode.value = DEFAULT_TRANSITION_MODE;
      selectedCurve.value = DEFAULT_TRANSITION_CURVE;
      const incomingParams =
        (normalizeTransitionParams('dissolve') as Record<string, unknown> | undefined) ?? {};
      if (!shallowEqualParams(selectedParams.value, incomingParams)) {
        selectedParams.value = incomingParams;
      }
    }
    void Promise.resolve().then(() => {
      if (syncGeneration === gen) syncGeneration = 0;
    });
  });

  watch(selectedType, (type) => {
    const manifest = getTransitionManifest(type);
    const nextParams = normalizeTransitionParams(type, selectedParams.value) as
      | Record<string, unknown>
      | undefined;
    selectedParams.value = nextParams ?? {
      ...(manifest?.defaultParams as Record<string, unknown> | undefined),
    };
  });

  const edgeIcon = computed(() =>
    options.edge.value === 'in'
      ? 'i-heroicons-arrow-left-end-on-rectangle'
      : 'i-heroicons-arrow-right-end-on-rectangle',
  );

  const selectedManifest = computed(() => getTransitionManifest(selectedType.value));

  function updateParam(key: string, value: unknown) {
    selectedParams.value = {
      ...selectedParams.value,
      [key]: value,
    };
    emitUpdate();
  }

  function emitUpdate() {
    if (syncGeneration > 0) return;

    const normalizedParams = normalizeTransitionParams(selectedType.value, selectedParams.value) as
      | Record<string, unknown>
      | undefined;

    options.onUpdate({
      trackId: options.trackId.value,
      itemId: options.itemId.value,
      edge: options.edge.value,
      transition: {
        type: selectedType.value,
        durationUs: Math.round(durationSec.value * 1_000_000),
        mode: selectedMode.value,
        curve: selectedCurve.value,
        params: normalizedParams,
      },
    });
  }

  const emitDebouncedDuration = useDebounceFn(emitUpdate, options.debounceMs ?? 80);

  watch(selectedType, emitUpdate);
  watch(selectedMode, emitUpdate);
  watch(selectedCurve, emitUpdate);
  watch(durationSec, () => {
    if (syncGeneration > 0) return;
    emitDebouncedDuration();
  });

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
    selectedManifest,
    selectedMode,
    selectedParams,
    selectedType,
    updateParam,
  };
}
