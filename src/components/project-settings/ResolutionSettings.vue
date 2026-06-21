<script setup lang="ts">
import { watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { markProjectSettingsManual } from '~/utils/project-settings';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

const { t } = useI18n();
const projectStore = useProjectStore();

watch(
  () => projectStore.projectSettings?.project,
  (newVal, oldVal) => {
    if (!newVal || !oldVal) return;
    const changed =
      newVal.width !== oldVal.width ||
      newVal.height !== oldVal.height ||
      newVal.fps !== oldVal.fps ||
      newVal.sampleRate !== oldVal.sampleRate ||
      newVal.orientation !== oldVal.orientation;
    // A manual edit pins the project: turn auto-detection off and mark geometry
    // and sample rate as resolved (single source of truth for "clear auto").
    if (changed && newVal.isAutoSettings) {
      markProjectSettingsManual(newVal);
    }
  },
  { deep: true },
);
</script>

<template>
  <div v-if="projectStore.projectSettings" class="space-y-2 pt-2 px-0">
    <UiFormSectionHeader :title="t('videoEditor.projectSettings.resolutionAndFps')" />
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
  </div>
</template>
