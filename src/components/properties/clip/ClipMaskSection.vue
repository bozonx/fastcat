<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem, ClipMask } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import type { ParamControl } from '~/components/properties/params';

const props = defineProps<{
  clip: TimelineClipItem;
}>();

const emit = defineEmits<{
  (e: 'updateMask', mask: Partial<ClipMask> | undefined): void;
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });

const maskControls = computed<ParamControl[]>(() => [
  {
    kind: 'file',
    key: 'sourcePath',
    labelKey: 'fastcat.clip.mask.file',
    emptyLabelKey: 'fastcat.clip.mask.dropFile',
    icon: 'i-heroicons-viewfinder-circle',
  },
  {
    kind: 'select',
    key: 'mode',
    labelKey: 'fastcat.clip.mask.mode',
    options: [
      { value: 'alpha', labelKey: 'fastcat.clip.mask.modeAlpha' },
      { value: 'luma', labelKey: 'fastcat.clip.mask.modeLuma' },
    ],
  },
  {
    kind: 'toggle',
    key: 'invert',
    labelKey: 'fastcat.clip.mask.invert',
  },
]);

const maskValues = computed(() => ({
  sourcePath: props.clip.mask?.source?.path,
  mode: props.clip.mask?.mode ?? 'alpha',
  invert: props.clip.mask?.invert ?? false,
}));

function handleUpdate(key: string, value: unknown) {
  const current = props.clip.mask ?? {};
  if (key === 'sourcePath') {
    if (!value) {
      emit('updateMask', undefined);
    } else {
      emit('updateMask', { ...current, source: { path: value as string } });
    }
  } else if (key === 'mode') {
    emit('updateMask', { ...current, mode: value as 'alpha' | 'luma' });
  } else if (key === 'invert') {
    emit('updateMask', { ...current, invert: value as boolean });
  }
}
</script>

<template>
  <PropertySection
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.clip.mask.title')"
    has-toggle
  >
    <template #header-actions>
      <button
        class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
        :title="t('common.actions.reset')"
        :disabled="!isEnabled"
        @click="emit('updateMask', undefined)"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>
    
    <div :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <ParamsRenderer
        :controls="maskControls"
        :values="maskValues"
        :disabled="!isEnabled"
        @update:value="handleUpdate"
      />
    </div>
  </PropertySection>
</template>
