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
  <PropertySection :title="t('fastcat.clip.mask.title', 'Mask')">
    <ParamsRenderer :controls="maskControls" :values="maskValues" @update:value="handleUpdate" />
  </PropertySection>
</template>
