<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getAllTransitionManifests } from '~/transitions';
import type { ClipTransition } from '~/timeline/types';
import type { TransitionParamField } from '~/transitions/core/registry';
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';
import AppButtonGroup from '~/components/ui/AppButtonGroup.vue';
import { useClipTransitionPanel } from '~/composables/timeline/useClipTransitionPanel';

const { t } = useI18n();

const props = defineProps<{
  edge: 'in' | 'out';
  trackId: string;
  itemId: string;
  transition: ClipTransition | undefined;
  maxDuration?: number;
}>();

const emit = defineEmits<{
  (
    e: 'update',
    payload: {
      trackId: string;
      itemId: string;
      edge: 'in' | 'out';
      transition: ClipTransition | null;
    },
  ): void;
}>();

const manifests = computed(() => getAllTransitionManifests());

const {
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
} = useClipTransitionPanel({
  edge: toRef(props, 'edge'),
  trackId: toRef(props, 'trackId'),
  itemId: toRef(props, 'itemId'),
  transition: toRef(props, 'transition'),
  maxDuration: toRef(props, 'maxDuration'),
  onUpdate: (payload) => emit('update', payload),
});

const modeOptions = computed(() => [
  {
    value: 'transition',
    label: t('granVideoEditor.timeline.transition.modeTransitionShort'),
    title: t('granVideoEditor.timeline.transition.modeTransition'),
  },
  {
    value: 'fade',
    label: t('granVideoEditor.timeline.transition.modeFadeShort'),
    title: t('granVideoEditor.timeline.transition.modeFade'),
  },
]);

const curveOptions = computed(() => [
  { value: 'linear', label: t('granVideoEditor.timeline.transition.curveLinear') },
  { value: 'bezier', label: t('granVideoEditor.timeline.transition.curveBezier') },
]);

function getSelectValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getColorValue(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : '#000000';
}

const visibleParamFields = computed<TransitionParamField[]>(() => {
  const fields = selectedManifest.value?.paramFields ?? [];

  const filtered = fields.filter((field) => {
    if (field.showIf && !field.showIf(selectedParams.value)) {
      return false;
    }
    return true;
  });

  if (selectedType.value !== 'wipe' && selectedType.value !== 'barn-door') {
    return filtered;
  }

  const edgeMode = selectedParams.value.edgeMode === 'blur' ? 'blur' : 'gap';

  return filtered.filter((field) => {
    if (field.key === 'gap' || field.key === 'gapColor') {
      return edgeMode === 'gap';
    }

    if (field.key === 'blur' || field.key === 'blurMode') {
      return edgeMode === 'blur';
    }

    return true;
  });
});
</script>

<template>
  <div
    class="flex flex-col gap-3 p-3 bg-ui-bg-elevated border border-ui-border rounded-lg text-xs text-ui-text min-w-56 shadow-lg"
  >
    <!-- Header with edge icon -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <UIcon :name="edgeIcon" class="w-4 h-4 shrink-0 text-primary-400" />
        <span
          >{{ edge === 'in' ? 'IN' : 'OUT' }}
          {{ t('granVideoEditor.timeline.transition.title') }}</span
        >
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
      <AppButtonGroup v-model="selectedMode" :options="modeOptions" />
    </div>

    <!-- Curve toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-ui-text-muted">{{ t('granVideoEditor.timeline.transition.curve') }}</span>
      <AppButtonGroup v-model="selectedCurve" :options="curveOptions" />
    </div>

    <div v-if="visibleParamFields.length" class="flex flex-col gap-2">
      <div class="text-ui-text-muted">
        {{ t('granVideoEditor.timeline.transition.parameters') }}
      </div>

      <div
        v-for="field in visibleParamFields"
        :key="`${selectedType}-${field.key}`"
        class="flex flex-col gap-1"
      >
        <span class="text-ui-text-muted">{{ t(field.labelKey) }}</span>

        <USelectMenu
          v-if="field.kind === 'select'"
          :model-value="getSelectValue(selectedParams[field.key])"
          :items="
            (field.options ?? []).map((option) => ({
              label: t(option.labelKey),
              value: option.value,
            }))
          "
          value-key="value"
          label-key="label"
          size="xs"
          @update:model-value="(value: any) => updateParam(field.key, value?.value ?? value)"
        />

        <UInput
          v-else-if="field.kind === 'number'"
          :model-value="getNumberValue(selectedParams[field.key])"
          type="number"
          size="xs"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? 0.01"
          @update:model-value="(value: string | number) => updateParam(field.key, Number(value))"
        />

        <DurationSliderInput
          v-else-if="field.kind === 'slider'"
          :model-value="getNumberValue(selectedParams[field.key]) ?? field.min ?? 0"
          :min="field.min ?? 0"
          :max="field.max ?? 1"
          :step="field.step ?? 0.01"
          :decimals="2"
          unit=""
          @update:model-value="(value: number) => updateParam(field.key, value)"
        />

        <input
          v-else-if="field.kind === 'color'"
          :value="getColorValue(selectedParams[field.key])"
          type="color"
          class="h-8 w-full rounded border border-ui-border bg-ui-bg px-1"
          @input="(event) => updateParam(field.key, (event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
  </div>
</template>
