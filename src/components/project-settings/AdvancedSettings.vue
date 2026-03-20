<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import UiWheelNumberInput from '~/components/ui/editor/UiWheelNumberInput.vue';
import SettingsSection from './SettingsSection.vue';

const { t } = useI18n();
const projectStore = useProjectStore();

const audioDeclickDurationMs = computed({
  get: () => (projectStore.projectSettings?.project.audioDeclickDurationUs || 0) / 1000,
  set: (val: number) => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.audioDeclickDurationUs = val * 1000;
    }
  },
});
</script>

<template>
  <SettingsSection
    v-if="projectStore.projectSettings"
    :title="t('videoEditor.projectSettings.advanced', 'Advanced')"
    :summary="t('videoEditor.projectSettings.advanced', 'Advanced')"
  >
    <UFormField :label="t('videoEditor.settings.audioDeclickDuration', 'Audio De-click Duration')">
      <UiWheelNumberInput v-model="audioDeclickDurationMs" :min="0" :max="500" :step="1" />
      <template #help>
        {{
          t(
            'videoEditor.settings.audioDeclickDurationHelp',
            'Micro-fades (linear) applied to edges of all clips to eliminate clicks. 0 disables it.',
          )
        }}
      </template>
    </UFormField>
  </SettingsSection>
</template>
