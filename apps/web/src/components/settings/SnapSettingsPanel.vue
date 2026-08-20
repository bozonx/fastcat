<script setup lang="ts">
import { useSnapSettings } from '~/composables/timeline/useSnapSettings';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';

const { t } = useI18n();
const {
  isSnapEnabled,
  snapThresholdPx,
  snapToTimelineEdges,
  snapToClips,
  snapToMarkers,
  snapToSelection,
  snapToPlayhead,
  snapPlayheadOnClick,
} = useSnapSettings();
</script>

<template>
  <div class="flex flex-col gap-5">
    <div
      :class="{
        'opacity-40 pointer-events-none': !isSnapEnabled,
      }"
      class="flex flex-col gap-5 transition-opacity duration-200"
    >
      <UiSliderInput
        v-model="snapThresholdPx"
        :label="t('videoEditor.settings.snapThresholdDefault')"
        :min="1"
        :max="50"
        :step="1"
        :default-value="8"
        unit="px"
      />

      <div class="flex flex-col gap-3">
        <p class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.snapToTargets') }}
        </p>
        <UCheckbox
          v-model="snapToTimelineEdges"
          :label="t('videoEditor.settings.snapToTimelineEdges')"
        />
        <UCheckbox v-model="snapToClips" :label="t('videoEditor.settings.snapToClips')" />
        <UCheckbox v-model="snapToMarkers" :label="t('videoEditor.settings.snapToMarkers')" />
        <UCheckbox v-model="snapToSelection" :label="t('videoEditor.settings.snapToSelection')" />
        <UCheckbox v-model="snapToPlayhead" :label="t('videoEditor.settings.snapToPlayhead')" />
        <UCheckbox
          v-model="snapPlayheadOnClick"
          :label="t('videoEditor.settings.snapPlayheadOnClick')"
        />
      </div>
    </div>
  </div>
</template>
