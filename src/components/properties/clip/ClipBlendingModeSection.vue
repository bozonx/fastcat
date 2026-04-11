<script setup lang="ts">
import type { TimelineBlendMode } from '~/timeline/types';
import UiSelect from '~/components/ui/UiSelect.vue';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  clipType: string;
  blendMode: TimelineBlendMode;
  blendModeOptions: Array<{ value: TimelineBlendMode; label: string }>;
}>();

const emit = defineEmits<{
  updateBlendMode: [val: TimelineBlendMode | string];
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });
</script>

<template>
  <PropertySection
    v-if="props.clipType !== 'adjustment'"
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.clip.blendMode.title')"
    has-toggle
  >
    <template #header-actions>
      <button
        class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
        :title="t('common.actions.reset')"
        :disabled="!isEnabled"
        @click="emit('updateBlendMode')"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>
    
    <div :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <UiSelect
        :model-value="props.blendMode"
        :items="props.blendModeOptions"
        value-key="value"
        label-key="label"
        size="sm"
        :disabled="!isEnabled"
        @update:model-value="
          (v: unknown) =>
            emit(
              'updateBlendMode',
              ((v as { value: TimelineBlendMode })?.value ?? v) as TimelineBlendMode | string,
            )
        "
      />
    </div>
  </PropertySection>
</template>
