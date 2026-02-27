<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { getAllTransitionManifests } from '~/transitions';
import type { ClipTransition } from '~/timeline/types';
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';

const { t } = useI18n();

const props = defineProps<{
  edge: 'in' | 'out';
  trackId: string;
  itemId: string;
  transition: ClipTransition | undefined;
}>();

const emit = defineEmits<{
  (
    e: 'update',
    payload: { trackId: string; itemId: string; edge: 'in' | 'out'; transition: ClipTransition | null },
  ): void;
}>();

const manifests = computed(() => getAllTransitionManifests());

const durationSec = ref(props.transition ? props.transition.durationUs / 1_000_000 : 0.5);
const selectedType = ref(props.transition?.type ?? 'dissolve');
const selectedMode = ref<'blend' | 'composite'>(props.transition?.mode ?? 'blend');
const selectedCurve = ref<'linear' | 'bezier'>(props.transition?.curve ?? 'linear');

// Track whether we're syncing from props to avoid emit loop
let isSyncingFromProps = false;

watch(
  () => props.transition,
  (t) => {
    isSyncingFromProps = true;
    if (t) {
      selectedType.value = t.type;
      durationSec.value = t.durationUs / 1_000_000;
      selectedMode.value = t.mode ?? 'blend';
      selectedCurve.value = t.curve ?? 'linear';
    }
    // Reset flag after Vue processes reactivity
    void Promise.resolve().then(() => { isSyncingFromProps = false; });
  },
);

const edgeIcon = computed(() =>
  props.edge === 'in' ? 'i-heroicons-arrow-left-end-on-rectangle' : 'i-heroicons-arrow-right-end-on-rectangle',
);

function emitUpdate() {
  if (isSyncingFromProps) return;
  emit('update', {
    trackId: props.trackId,
    itemId: props.itemId,
    edge: props.edge,
    transition: {
      type: selectedType.value,
      durationUs: Math.round(durationSec.value * 1_000_000),
      mode: selectedMode.value,
      curve: selectedCurve.value,
    },
  });
}

// Debounce slider changes to avoid spamming commands
const emitDebouncedDuration = useDebounceFn(emitUpdate, 80);

watch(selectedType, emitUpdate);
watch(selectedMode, emitUpdate);
watch(selectedCurve, emitUpdate);
watch(durationSec, emitDebouncedDuration);

function remove() {
  emit('update', {
    trackId: props.trackId,
    itemId: props.itemId,
    edge: props.edge,
    transition: null,
  });
}

const durationMin = 0.1;
const durationMax = 3;
const durationStep = 0.05;
</script>

<template>
  <div class="flex flex-col gap-3 p-3 bg-ui-bg-elevated border border-ui-border rounded-lg text-xs text-ui-text min-w-56 shadow-lg">
    <!-- Header with edge icon -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold">
        <UIcon :name="edgeIcon" class="w-4 h-4 shrink-0 text-primary-400" />
        <span>{{ t('granVideoEditor.timeline.transition.title') }}</span>
      </div>
      <UButton
        v-if="transition"
        color="red"
        variant="ghost"
        size="xs"
        icon="i-heroicons-trash"
        :title="
          edge === 'in'
            ? t('granVideoEditor.timeline.removeTransitionIn')
            : t('granVideoEditor.timeline.removeTransitionOut')
        "
        @click="remove"
      />
    </div>

    <!-- Transition type picker -->
    <div class="flex flex-col gap-1.5">
      <button
        v-for="manifest in manifests"
        :key="manifest.type"
        type="button"
        class="flex items-center gap-2 px-2 py-1.5 rounded border transition-colors"
        :class="
          selectedType === manifest.type
            ? 'bg-primary-500/20 border-primary-500 text-primary-400'
            : 'bg-ui-bg border-ui-border hover:bg-ui-bg-hover'
        "
        @click="selectedType = manifest.type"
      >
        <UIcon :name="manifest.icon" class="w-4 h-4 shrink-0" />
        <span>{{ manifest.name }}</span>
      </button>
    </div>

    <!-- Duration slider -->
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-ui-text-muted">
        <span>{{ t('granVideoEditor.timeline.transition.duration') }}</span>
      </div>
      <DurationSliderInput
        v-model="durationSec"
        :min="durationMin"
        :max="durationMax"
        :step="durationStep"
        unit="s"
        :decimals="2"
      />
    </div>

    <!-- Mode toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-ui-text-muted">{{ t('granVideoEditor.timeline.transition.mode') }}</span>
      <div class="flex rounded overflow-hidden border border-ui-border">
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors text-xs"
          :class="selectedMode === 'blend' ? 'bg-primary-500 text-[color:var(--on-primary)]' : 'bg-ui-bg hover:bg-ui-bg-hover'"
          @click="selectedMode = 'blend'"
        >
          {{ t('granVideoEditor.timeline.transition.modeBlend') }}
        </button>
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors border-l border-ui-border text-xs"
          :class="selectedMode === 'composite' ? 'bg-primary-500 text-[color:var(--on-primary)]' : 'bg-ui-bg hover:bg-ui-bg-hover'"
          @click="selectedMode = 'composite'"
        >
          {{ t('granVideoEditor.timeline.transition.modeComposite') }}
        </button>
      </div>
    </div>

    <!-- Curve toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-ui-text-muted">{{ t('granVideoEditor.timeline.transition.curve') }}</span>
      <div class="flex rounded overflow-hidden border border-ui-border">
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors text-xs"
          :class="selectedCurve === 'linear' ? 'bg-primary-500 text-[color:var(--on-primary)]' : 'bg-ui-bg hover:bg-ui-bg-hover'"
          @click="selectedCurve = 'linear'"
        >
          {{ t('granVideoEditor.timeline.transition.curveLinear') }}
        </button>
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors border-l border-ui-border text-xs"
          :class="selectedCurve === 'bezier' ? 'bg-primary-500 text-[color:var(--on-primary)]' : 'bg-ui-bg hover:bg-ui-bg-hover'"
          @click="selectedCurve = 'bezier'"
        >
          {{ t('granVideoEditor.timeline.transition.curveBezier') }}
        </button>
      </div>
    </div>
  </div>
</template>
