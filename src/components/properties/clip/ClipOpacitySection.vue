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
    <template #header-actions>
      <button
        class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
        :title="t('common.actions.reset', 'Reset')"
        :disabled="!isEnabled"
        @click="emit('updateOpacity', 1)"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>
    
    <div :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
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
    </div>
  </PropertySection>
</template>
