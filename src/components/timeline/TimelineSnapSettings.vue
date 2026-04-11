<script setup lang="ts">
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

const timelineEdges = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.timelineEdges,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.timelineEdges = val),
});

const clips = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.clips,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.clips = val),
});

const markers = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.markers,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.markers = val),
});

const selection = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.selection,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.selection = val),
});

const playhead = computed({
  get: () => workspaceStore.userSettings.timeline.snapping.playhead,
  set: (val: boolean) => (workspaceStore.userSettings.timeline.snapping.playhead = val),
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h3 class="text-lg font-medium text-ui-text">
        {{ t('videoEditor.settings.snappingTitle') }}
      </h3>
      <p class="text-sm text-ui-text-muted mt-1">
        {{ t('videoEditor.settings.snappingDescription') }}
      </p>
    </div>

    <div class="space-y-4 max-w-xl">
      <UiSliderInput
        v-model="snapThresholdPx"
        :label="t('videoEditor.settings.snapThresholdDefault')"
        :min="1"
        :max="100"
        :step="1"
        :default-value="10"
        unit="px"
      />

      <div class="pt-4 space-y-4">
        <h4 class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.snapToTargets') }}
        </h4>

        <UCheckbox
          v-model="timelineEdges"
          :label="t('videoEditor.settings.snapToTimelineEdges')"
        />

        <UCheckbox v-model="clips" :label="t('videoEditor.settings.snapToClips')" />

        <UCheckbox v-model="markers" :label="t('videoEditor.settings.snapToMarkers')" />

        <UCheckbox
          v-model="selection"
          :label="t('videoEditor.settings.snapToSelection')"
        />

        <UCheckbox
          v-model="playhead"
          :label="t('videoEditor.settings.snapToPlayhead')"
        />
      </div>
    </div>
  </div>
</template>
