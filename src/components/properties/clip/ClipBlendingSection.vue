<script setup lang="ts">
import type { TimelineBlendMode } from '~/timeline/types';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

const props = defineProps<{
  clipType: string;
  opacity: number;
  blendMode: TimelineBlendMode;
  blendModeOptions: Array<{ value: TimelineBlendMode; label: string }>;
}>();

const emit = defineEmits<{
  updateOpacity: [val: number];
  updateBlendMode: [val: TimelineBlendMode | string];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="props.clipType !== 'adjustment'"
    class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border"
  >
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-ui-text-muted">{{
        t('fastcat.clip.blendMode.title', 'Blend mode')
      }}</span>
      <UiSelect
        :model-value="props.blendMode"
        :items="props.blendModeOptions"
        value-key="value"
        label-key="label"
        size="sm"
        @update:model-value="
          (v: unknown) =>
            emit(
              'updateBlendMode',
              ((v as { value: TimelineBlendMode })?.value ?? v) as TimelineBlendMode | string,
            )
        "
      />
    </div>

    <UiSliderInput
      :label="t('fastcat.clip.opacity', 'Opacity')"
      unit="%"
      :model-value="props.opacity"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      :wheel-step-multiplier="10"
      @update:model-value="emit('updateOpacity', $event)"
    />
  </div>
</template>
