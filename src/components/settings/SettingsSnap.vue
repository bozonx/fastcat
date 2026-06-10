<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const settingsStore = useTimelineSettingsStore();

const snapThresholdPx = computed({
  get: () => workspaceStore.userSettings.timeline.snapThresholdPx,
  set: (val: number) => settingsStore.setGlobalSnapThresholdPx(val),
});

const snapToTimelineEdges = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.timelineEdges,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.timelineEdges = val),
});

const snapToClips = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.clips,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.clips = val),
});

const snapToMarkers = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.markers,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.markers = val),
});

const snapToSelection = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.selection,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.selection = val),
});

const snapToPlayhead = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.playhead,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playhead = val),
});

const snapPlayheadOnClick = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.playheadClick,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playheadClick = val),
});
</script>

<template>
  <div class="flex flex-col gap-5">
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
</template>
