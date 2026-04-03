<script setup lang="ts">
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  clipType: string;
  opacity: number;
}>();

const emit = defineEmits<{
  updateOpacity: [val: number];
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });
</script>

<template>
  <PropertySection
    v-if="props.clipType !== 'adjustment'"
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.clip.opacity', 'Opacity')"
    has-toggle
  >
    <UiSliderInput
      unit="%"
      :model-value="props.opacity"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      :wheel-step-multiplier="10"
      :disabled="!isEnabled"
      @update:model-value="emit('updateOpacity', $event)"
    />
  </PropertySection>
</template>
