<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { cloneValue } from '~/utils/clone';
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

interface ParametricEqPoint {
  enabled?: boolean;
  type?: BiquadFilterType;
  frequency?: number;
  q?: number;
  gain?: number;
}

const EQ_CANVAS_WIDTH = 720;
const EQ_CANVAS_HEIGHT = 220;
const EQ_MIN_FREQUENCY = 20;
const EQ_MAX_FREQUENCY = 20000;
const EQ_MIN_GAIN = -24;
const EQ_MAX_GAIN = 24;
const EQ_MIN_Q = 0.1;
const EQ_MAX_Q = 20;
const EQ_GAUSSIAN_BASE_WIDTH = 1.6;
const EQ_GAUSSIAN_MIN_WIDTH = 0.12;
const EQ_SHELF_STEEPNESS = 4;
const EQ_LOWPASS_ATTENUATION_DB = -24;
const EQ_BANDPASS_ATTENUATION_DB = -18;
const EQ_NOTCH_ATTENUATION_DB = -24;

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function frequencyToX(frequency: number) {
  const minFrequency = EQ_MIN_FREQUENCY;
  const maxFrequency = EQ_MAX_FREQUENCY;
  const safeFrequency = clamp(frequency, minFrequency, maxFrequency);
  const ratio =
    (Math.log10(safeFrequency) - Math.log10(minFrequency)) /
    (Math.log10(maxFrequency) - Math.log10(minFrequency));

  return ratio * canvasWidth;
}

function gainToY(gain: number) {
  const minGain = EQ_MIN_GAIN;
  const maxGain = EQ_MAX_GAIN;
  const ratio = (clamp(gain, minGain, maxGain) - minGain) / (maxGain - minGain);

  return canvasHeight - ratio * canvasHeight;
}

function getPointContribution(point: ParametricEqPoint, frequency: number) {
  if (!point.enabled) {
    return 0;
  }

  const pointFrequency = clamp(point.frequency ?? 1000, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  const normalizedQ = clamp(point.q ?? 1, EQ_MIN_Q, EQ_MAX_Q);
  const gain = clamp(point.gain ?? 0, EQ_MIN_GAIN, EQ_MAX_GAIN);
  const distance = Math.abs(Math.log2(frequency / pointFrequency));
  const gaussianWidth = Math.max(EQ_GAUSSIAN_MIN_WIDTH, EQ_GAUSSIAN_BASE_WIDTH / normalizedQ);
  const gaussian = Math.exp(-0.5 * (distance / gaussianWidth) ** 2);

  switch (point.type) {
    case 'peaking':
      return gain * gaussian;
    case 'lowshelf':
      return (
        gain /
        (1 + Math.exp((distance * EQ_SHELF_STEEPNESS * Math.sign(frequency - pointFrequency)) / gaussianWidth))
      );
    case 'highshelf':
      return (
        gain /
        (1 + Math.exp((distance * -EQ_SHELF_STEEPNESS * Math.sign(frequency - pointFrequency)) / gaussianWidth))
      );
    case 'lowpass':
      return frequency > pointFrequency ? EQ_LOWPASS_ATTENUATION_DB * (1 - Math.exp(-distance * normalizedQ)) : 0;
    case 'highpass':
      return frequency < pointFrequency ? EQ_LOWPASS_ATTENUATION_DB * (1 - Math.exp(-distance * normalizedQ)) : 0;
    case 'bandpass':
      return EQ_BANDPASS_ATTENUATION_DB * (1 - gaussian);
    case 'notch':
      return -Math.min(Math.abs(EQ_NOTCH_ATTENUATION_DB), Math.abs(EQ_NOTCH_ATTENUATION_DB) * gaussian);
    case 'allpass':
    default:
      return 0;
  }
}

function drawEqVisualization() {
  const canvas = curveCanvas.value;
  if (!canvas || !isParametricEq.value) {
    return;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  context.lineWidth = 1;

  const frequencyMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  context.font = '10px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'top';

  for (const marker of frequencyMarkers) {
    const x = frequencyToX(marker);

    // Draw line
    context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvasHeight);
    context.stroke();

    // Draw text label
    context.fillStyle = 'rgba(148, 163, 184, 0.7)';
    const label = marker >= 1000 ? `${marker / 1000}k` : String(marker);
    context.fillText(label, x, canvasHeight - 16);
  }

  const gainMarkers = [-24, -12, 0, 12, 24];

  context.textAlign = 'right';
  context.textBaseline = 'middle';

  for (const marker of gainMarkers) {
    const y = gainToY(marker);

    // Draw line
    context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvasWidth, y);
    context.stroke();

    // Draw text label
    if (marker !== 0) {
      context.fillStyle = 'rgba(148, 163, 184, 0.7)';
      context.fillText(`${marker > 0 ? '+' : ''}${marker}dB`, canvasWidth - 4, y);
    }
  }

  context.strokeStyle = 'rgba(45, 212, 191, 0.28)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, gainToY(0));
  context.lineTo(canvasWidth, gainToY(0));
  context.stroke();

  context.strokeStyle = '#2dd4bf';
  context.lineWidth = 2.5;
  context.beginPath();

  for (let x = 0; x <= canvasWidth; x += 1) {
    const frequency = 20 * 10 ** ((x / canvasWidth) * 3);
    const totalGain = clamp(
      eqPoints.value.reduce((sum, point) => sum + getPointContribution(point, frequency), 0),
      EQ_MIN_GAIN,
      EQ_MAX_GAIN,
    );
    const y = gainToY(totalGain);

    if (x === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  for (const point of eqPoints.value) {
    if (!point.enabled) {
      continue;
    }

    const x = frequencyToX(point.frequency ?? 1000);
    const y = gainToY(clamp(point.gain ?? 0, EQ_MIN_GAIN, EQ_MAX_GAIN));

    context.fillStyle = '#22c55e';
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
  }
}

function scheduleEqVisualizationDraw() {
  if (!isParametricEq.value) {
    return;
  }

  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }

  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null;
    drawEqVisualization();
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
