<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';

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
        {{ t('videoEditor.settings.snappingTitle', 'Snapping') }}
      </h3>
      <p class="text-sm text-ui-text-muted mt-1">
        {{
          t('videoEditor.settings.snappingDescription', 'Configure timeline snapping behavior.')
        }}
      </p>
    </div>

    <div class="space-y-4 max-w-xl">
      <UFormField :label="t('videoEditor.settings.snapThresholdDefault', 'Snap threshold default (px)')">
        <div class="flex items-center gap-4">
          <UiWheelSlider
            v-model="snapThresholdPx"
            :min="1"
            :max="100"
            :step="1"
            class="flex-1"
          />
          <div class="text-xs font-mono text-ui-text-muted w-8 text-right">
            {{ snapThresholdPx }}
          </div>
        </div>
      </UFormField>

      <div class="pt-4 space-y-4">
        <h4 class="text-sm font-medium text-ui-text">
          {{ t('videoEditor.settings.snapToTargets', 'Snap to') }}
        </h4>

        <UCheckbox
          v-model="timelineEdges"
          :label="t('videoEditor.settings.snapToTimelineEdges', 'Timeline start and end')"
        />
        
        <UCheckbox
          v-model="clips"
          :label="t('videoEditor.settings.snapToClips', 'Clips')"
        />
        
        <UCheckbox
          v-model="markers"
          :label="t('videoEditor.settings.snapToMarkers', 'Markers')"
        />
        
        <UCheckbox
          v-model="selection"
          :label="t('videoEditor.settings.snapToSelection', 'Selection')"
        />
        
        <UCheckbox
          v-model="playhead"
          :label="t('videoEditor.settings.snapToPlayhead', 'Playhead')"
        />
      </div>
    </div>
  </div>
</template>
