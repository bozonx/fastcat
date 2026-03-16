<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveProjectPreset } from '~/utils/settings';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import SettingsSection from './SettingsSection.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const resolutionSummary = computed(() => {
  const p = projectStore.projectSettings?.project;
  if (!p) return '';
  return `${p.width}x${p.height}, ${p.fps}FPS, ${p.sampleRate / 1000}kHz`;
});

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

function applyProjectPreset(presetId: string) {
  if (!projectStore.projectSettings) return;

  const preset =
    workspaceStore.userSettings.projectPresets.items.find((item) => item.id === presetId) ??
    resolveProjectPreset(workspaceStore.userSettings.projectPresets);

  projectStore.projectSettings.project.width = preset.width;
  projectStore.projectSettings.project.height = preset.height;
  projectStore.projectSettings.project.fps = preset.fps;
  projectStore.projectSettings.project.resolutionFormat = preset.resolutionFormat;
  projectStore.projectSettings.project.orientation = preset.orientation;
  projectStore.projectSettings.project.aspectRatio = preset.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = preset.isCustomResolution;
  projectStore.projectSettings.project.sampleRate = preset.sampleRate;
}
</script>

<template>
  <SettingsSection
    v-if="projectStore.projectSettings"
    :title="t('videoEditor.projectSettings.resolutionAndFps', 'Resolution & FPS')"
    :summary="resolutionSummary"
  >
    <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
      <div class="flex items-center gap-2">
        <USelectMenu
          v-model="workspaceStore.userSettings.projectPresets.selectedPresetId"
          :items="projectPresetOptions"
          value-key="value"
          label-key="label"
          class="w-full"
        />
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          :label="t('common.apply', 'Apply')"
          @click="applyProjectPreset(workspaceStore.userSettings.projectPresets.selectedPresetId)"
        />
      </div>
    </UFormField>

    <MediaResolutionSettings
      v-model:width="projectStore.projectSettings.project.width"
      v-model:height="projectStore.projectSettings.project.height"
      v-model:fps="projectStore.projectSettings.project.fps"
      v-model:resolution-format="projectStore.projectSettings.project.resolutionFormat"
      v-model:orientation="projectStore.projectSettings.project.orientation"
      v-model:aspect-ratio="projectStore.projectSettings.project.aspectRatio"
      v-model:is-custom-resolution="projectStore.projectSettings.project.isCustomResolution"
      v-model:sample-rate="projectStore.projectSettings.project.sampleRate"
    />
  </SettingsSection>
</template>
