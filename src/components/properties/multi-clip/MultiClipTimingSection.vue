<script setup lang="ts">
import PropertyField from '~/components/properties/PropertyField.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';
import type { TimelineClipItem } from '~/timeline/types';

defineProps<{
  firstClip: TimelineClipItem | undefined;
  durationShiftAccumulator: number;
  startShiftAccumulator: number;
  endShiftAccumulator: number;
  hideUniformDuration?: boolean;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  setUniformDuration: [durationUs: number];
  durationShiftChange: [value: number];
  startShiftChange: [value: number];
  endShiftChange: [value: number];
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection v-if="!isMobile" :title="t('fastcat.clip.info')">
    <PropertyTimecode
      v-if="!hideUniformDuration"
      :label="t('common.duration')"
      :model-value="firstClip?.timelineRange.durationUs ?? 0"
      @update:model-value="(value) => emit('setUniformDuration', value)"
    />

    <PropertyField :label="t('fastcat.timeline.durationShift')" class="mt-2">
      <UiTimecode
        :model-value="durationShiftAccumulator"
        allow-negative
        @update:model-value="(value) => emit('durationShiftChange', value)"
      />
    </PropertyField>

    <PropertyField :label="t('fastcat.timeline.startShift')" class="mt-2">
      <UiTimecode
        :model-value="startShiftAccumulator"
        allow-negative
        @update:model-value="(value) => emit('startShiftChange', value)"
      />
    </PropertyField>

    <PropertyField :label="t('fastcat.timeline.endShift')" class="mt-2">
      <UiTimecode
        :model-value="endShiftAccumulator"
        allow-negative
        @update:model-value="(value) => emit('endShiftChange', value)"
      />
    </PropertyField>
  </PropertySection>
</template>
