<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  clip: any;
}>();

const emit = defineEmits<{
  (e: 'updateBackgroundColor', val: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('common.color')">
    <div class="flex items-center justify-between gap-3">
      <span class="font-mono text-xs text-ui-text">{{ clip.backgroundColor }}</span>
      <UColorPicker
        :model-value="clip.backgroundColor"
        format="hex"
        size="sm"
        @update:model-value="emit('updateBackgroundColor', String($event))"
      />
    </div>
  </PropertySection>
</template>
