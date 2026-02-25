<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getAllTransitionManifests } from '~/transitions';
import type { ClipTransition } from '~/timeline/types';

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

watch(
  () => props.transition,
  (t) => {
    if (t) {
      selectedType.value = t.type;
      durationSec.value = t.durationUs / 1_000_000;
      selectedMode.value = t.mode ?? 'blend';
      selectedCurve.value = t.curve ?? 'linear';
    }
  },
);

const edgeIcon = computed(() =>
  props.edge === 'in' ? 'i-heroicons-arrow-left-end-on-rectangle' : 'i-heroicons-arrow-right-end-on-rectangle',
);

function apply() {
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

function remove() {
  emit('update', {
    trackId: props.trackId,
    itemId: props.itemId,
    edge: props.edge,
    transition: null,
  });
}

const durationMin = 0.1;
const durationMax = 5;
const durationStep = 0.05;
</script>

<template>
  <div class="flex flex-col gap-3 p-3 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 min-w-52">
    <!-- Header with edge icon -->
    <div class="flex items-center gap-2 font-semibold text-gray-100">
      <span :class="edgeIcon" class="w-4 h-4 shrink-0 text-indigo-400" />
      <span>{{ t('granVideoEditor.timeline.transition.title') }}</span>
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
            ? 'bg-indigo-600 border-indigo-400 text-white'
            : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
        "
        @click="selectedType = manifest.type"
      >
        <span :class="manifest.icon" class="w-4 h-4 shrink-0" />
        <span>{{ manifest.name }}</span>
      </button>
    </div>

    <!-- Duration slider -->
    <div class="flex flex-col gap-1">
      <label class="text-gray-400">
        {{ t('granVideoEditor.timeline.transition.duration') }}: {{ durationSec.toFixed(2) }}s
      </label>
      <input
        v-model.number="durationSec"
        type="range"
        :min="durationMin"
        :max="durationMax"
        :step="durationStep"
        class="w-full accent-indigo-500"
      />
    </div>

    <!-- Mode toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-gray-400">{{ t('granVideoEditor.timeline.transition.mode') }}</span>
      <div class="flex rounded overflow-hidden border border-gray-600">
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors"
          :class="selectedMode === 'blend' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'"
          @click="selectedMode = 'blend'"
        >
          {{ t('granVideoEditor.timeline.transition.modeBlend') }}
        </button>
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors border-l border-gray-600"
          :class="selectedMode === 'composite' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'"
          @click="selectedMode = 'composite'"
        >
          {{ t('granVideoEditor.timeline.transition.modeComposite') }}
        </button>
      </div>
    </div>

    <!-- Curve toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-gray-400">{{ t('granVideoEditor.timeline.transition.curve') }}</span>
      <div class="flex rounded overflow-hidden border border-gray-600">
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors"
          :class="selectedCurve === 'linear' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'"
          @click="selectedCurve = 'linear'"
        >
          {{ t('granVideoEditor.timeline.transition.curveLinear') }}
        </button>
        <button
          type="button"
          class="flex-1 py-1 text-center transition-colors border-l border-gray-600"
          :class="selectedCurve === 'bezier' ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600'"
          @click="selectedCurve = 'bezier'"
        >
          {{ t('granVideoEditor.timeline.transition.curveBezier') }}
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
        @click="apply"
      >
        {{ t('common.apply') }}
      </button>
      <button
        v-if="transition"
        class="px-2 py-1 rounded bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white transition-colors"
        :title="
          edge === 'in'
            ? t('granVideoEditor.timeline.removeTransitionIn')
            : t('granVideoEditor.timeline.removeTransitionOut')
        "
        @click="remove"
      >
        <span class="i-heroicons-trash w-4 h-4" />
      </button>
    </div>
  </div>
</template>
