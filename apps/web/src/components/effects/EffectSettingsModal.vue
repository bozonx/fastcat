<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { cloneValue } from '~/utils/clone';
import {
  EQ_CANVAS_WIDTH,
  EQ_CANVAS_HEIGHT,
  drawParametricEqVisualization,
  type ParametricEqPoint,
} from '~/utils/eq/parametric-eq-render';
import type { EffectManifest } from '~/effects/core/registry';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

import UiModal from '~/components/ui/UiModal.vue';

const props = defineProps<{
  modelValue: boolean;
  effect?: Record<string, unknown>;
  manifest?: EffectManifest;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:effect': [updates: Record<string, unknown>];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const settingsControls = computed(() => {
  return props.manifest?.settingsControls ?? [];
});

const effectValues = computed(() => {
  return props.effect ?? {};
});

const curveCanvas = ref<HTMLCanvasElement | null>(null);
const canvasWidth = EQ_CANVAS_WIDTH;
const canvasHeight = EQ_CANVAS_HEIGHT;

const isParametricEq = computed(() => {
  return props.manifest?.type === 'audio-parametric-eq';
});

const eqPoints = computed<ParametricEqPoint[]>(() => {
  const points = props.effect?.points;

  return Array.isArray(points) ? points : [];
});

let animationFrameId: number | null = null;

function scheduleEqVisualizationDraw() {
  if (!isParametricEq.value) {
    return;
  }

  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    const canvas = curveCanvas.value;
    if (!canvas) return;
    drawParametricEqVisualization({
      canvas,
      points: eqPoints.value,
      canvasWidth,
      canvasHeight,
    });
  });
}

function handleUpdateValue(key: string, value: unknown) {
  // Support nested paths for array updates like "points.0.gain"
  const keys = key.split('.');

  if (keys.length === 1) {
    emit('update:effect', { [key]: value });
    return;
  }

  // Create a deep copy of the property
  const rootKey = keys[0];
  if (!rootKey) return;
  const updates: Record<string, unknown> = {
    [rootKey]: cloneValue(effectValues.value[rootKey] ?? {}),
  };

  // Traverse and set
  let current = updates[rootKey] as Record<string, unknown>;
  for (let i = 1; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!k) continue;
    if (current[k] === undefined) {
      current[k] = isNaN(Number(keys[i + 1])) ? {} : [];
    }
    const next = current[k];
    if (next !== null && typeof next === 'object') {
      current = next as Record<string, unknown>;
    } else {
      return;
    }
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
  emit('update:effect', updates);
}

function handleClose() {
  isOpen.value = false;
}

watch(
  [isOpen, isParametricEq, eqPoints],
  async ([open, isEq]) => {
    if (!open || !isEq) {
      return;
    }

    await nextTick();
    scheduleEqVisualizationDraw();
  },
  { immediate: true, deep: true },
);

onMounted(() => {
  scheduleEqVisualizationDraw();
});

onBeforeUnmount(() => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
});
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="manifest?.name ?? t('fastcat.effects.settings')"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <div v-if="settingsControls.length > 0" class="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
      <div
        v-if="isParametricEq"
        class="rounded-lg border border-white/10 bg-zinc-950/90 p-3 space-y-3"
        data-testid="parametric-eq-visualization"
      >
        <div class="flex items-center justify-between gap-3 text-xs text-zinc-300">
          <span>20 Hz</span>
          <span>-24 dB ... +24 dB</span>
          <span>20 kHz</span>
        </div>
        <canvas
          ref="curveCanvas"
          :width="canvasWidth"
          :height="canvasHeight"
          class="h-44 w-full rounded-md border border-white/8 bg-zinc-900"
        />
      </div>
      <ParamsRenderer
        :controls="settingsControls"
        :values="effectValues"
        size="sm"
        @update:value="handleUpdateValue"
      />
    </div>
    <UiEmptyState
      v-else
      :message="t('fastcat.effects.noSettings')"
      wrapper-class="py-8 text-sm not-italic"
    />
    <template #footer>
      <div class="flex justify-end w-full">
        <UButton color="primary" autofocus @click="handleClose">
          {{ t('common.done') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
