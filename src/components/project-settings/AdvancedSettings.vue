<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
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

const defaultAudioFadeCurve = computed({
  get: () => projectStore.projectSettings?.project.defaultAudioFadeCurve || 'logarithmic',
  set: (val: 'linear' | 'logarithmic') => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.defaultAudioFadeCurve = val;
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
      <WheelNumberInput v-model="audioDeclickDurationMs" :min="0" :max="500" :step="1" />
      <template #help>
        {{ t('videoEditor.settings.audioDeclickDurationHelp', 'Micro-fades (linear) applied to edges of all clips to eliminate clicks. 0 disables it.') }}
      </template>
    </UFormField>

    <UFormField
      :label="t('videoEditor.settings.defaultAudioFadeCurveTitle', 'Default Fade Curve')"
      :help="t('videoEditor.settings.defaultAudioFadeCurveHint', 'Default curve used for audio fades when you manually create a fade. (De-click always uses a short linear fade).')"
    >
      <div class="flex items-center gap-1 rounded bg-ui-bg p-1 w-fit">
        <UButton
          size="xs"
          :variant="defaultAudioFadeCurve === 'logarithmic' ? 'solid' : 'ghost'"
          :color="defaultAudioFadeCurve === 'logarithmic' ? 'primary' : 'neutral'"
          @click="defaultAudioFadeCurve = 'logarithmic'"
        >
          Logarithmic
        </UButton>
        <UButton
          size="xs"
          :variant="defaultAudioFadeCurve === 'linear' ? 'solid' : 'ghost'"
          :color="defaultAudioFadeCurve === 'linear' ? 'primary' : 'neutral'"
          @click="defaultAudioFadeCurve = 'linear'"
        >
          Linear
        </UButton>
      </div>
    </UFormField>
  </SettingsSection>
</template>
