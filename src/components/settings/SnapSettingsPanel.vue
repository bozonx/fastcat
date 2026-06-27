<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useSnapSettings } from '~/composables/timeline/useSnapSettings';
import { useMobileLayout } from '~/composables/useMobileLayout';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';

const { t } = useI18n();
const settingsStore = useTimelineSettingsStore();
const { isMobileLayout } = useMobileLayout();
const {
  snapModeOptions,
  isSnapEnabled,
  snapThresholdPx,
  snapToTimelineEdges,
  snapToClips,
  snapToMarkers,
  snapToSelection,
  snapToPlayhead,
  snapPlayheadOnClick,
} = useSnapSettings();

const isSnapEnabledWritable = computed({
  get: () => isSnapEnabled.value,
  set: (val: boolean) => {
    settingsStore.selectToolbarSnapMode(val ? 'snap' : 'no_snap');
  },
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Switch for mobile / Segmented control for desktop -->
    <div
      v-if="isMobileLayout"
      class="flex items-center justify-between gap-3 bg-ui-bg-elevated p-3.5 rounded-xl border border-ui-border"
    >
      <div class="flex items-center gap-2.5">
        <UIcon name="i-heroicons-link" class="size-5 text-ui-text shrink-0" />
        <span class="text-sm font-medium text-ui-text">
          {{ t('fastcat.timeline.snapMode') }}
        </span>
      </div>
      <USwitch v-model="isSnapEnabledWritable" size="md" />
    </div>

    <div v-else class="flex rounded-xl bg-ui-bg p-1 gap-1">
      <button
        v-for="opt in snapModeOptions"
        :key="opt.value"
        class="flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
        :class="
          settingsStore.toolbarSnapMode === opt.value
            ? 'bg-primary-500 text-white'
            : 'text-ui-text hover:bg-ui-bg-hover'
        "
        @click="settingsStore.selectToolbarSnapMode(opt.value)"
      >
        <UIcon :name="opt.icon" class="size-4 shrink-0" />
        <span>{{ opt.label }}</span>
      </button>
    </div>

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
        :max="100"
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
