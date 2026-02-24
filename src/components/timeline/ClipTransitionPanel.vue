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

const durationSec = ref(
  props.transition ? props.transition.durationUs / 1_000_000 : 0.5,
);
const selectedType = ref(props.transition?.type ?? 'dissolve');

watch(
  () => props.transition,
  (t) => {
    if (t) {
      selectedType.value = t.type;
      durationSec.value = t.durationUs / 1_000_000;
    }
  },
);

const title = computed(() =>
  props.edge === 'in'
    ? t('granVideoEditor.timeline.transition.panelIn')
    : t('granVideoEditor.timeline.transition.panelOut'),
);

function apply() {
  emit('update', {
    trackId: props.trackId,
    itemId: props.itemId,
    edge: props.edge,
    transition: {
      type: selectedType.value,
      durationUs: Math.round(durationSec.value * 1_000_000),
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
  <div class="flex flex-col gap-3 p-3 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 min-w-48">
    <div class="font-semibold text-gray-100">{{ title }}</div>

    <!-- Transition type picker -->
    <div class="flex flex-col gap-1.5">
      <button
        v-for="manifest in manifests"
        :key="manifest.type"
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
        :title="edge === 'in' ? t('granVideoEditor.timeline.removeTransitionIn') : t('granVideoEditor.timeline.removeTransitionOut')"
        @click="remove"
      >
        <span class="i-heroicons-trash w-4 h-4" />
      </button>
    </div>
  </div>
</template>
