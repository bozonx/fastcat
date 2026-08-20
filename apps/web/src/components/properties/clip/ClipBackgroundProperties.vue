<script setup lang="ts">
import type { TimelineBackgroundClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import UiColorBlendPicker from '~/components/ui/UiColorBlendPicker.vue';

defineProps<{
  clip: TimelineBackgroundClipItem;
}>();

const emit = defineEmits<{
  (e: 'updateBackgroundColor', val: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('common.color')">
    <UiColorBlendPicker
      :color="String(clip.backgroundColor)"
      :show-alpha="false"
      :show-blend-mode="false"
      @update:color="emit('updateBackgroundColor', $event)"
    />
  </PropertySection>
</template>
