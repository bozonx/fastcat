<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TICKS_PER_MILLISECOND } from '~/utils/time';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import SettingsSection from './SettingsSection.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const audioDeclickDurationMs = computed({
  get: () =>
    (projectStore.projectSettings?.project.audioDeclickDurationTicks || 0) / TICKS_PER_MILLISECOND,
  set: (val: number) => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.audioDeclickDurationTicks = val * TICKS_PER_MILLISECOND;
    }
  },
});

const defaultDeclickMs = computed(() => {
  const us = workspaceStore.userSettings?.projectDefaults?.audioDeclickDurationTicks;
  return (us !== undefined ? us : 5 * TICKS_PER_MILLISECOND) / TICKS_PER_MILLISECOND;
});

const isDifferentFromDefault = computed(() => {
  return audioDeclickDurationMs.value !== defaultDeclickMs.value;
});

function resetToDefault() {
  audioDeclickDurationMs.value = defaultDeclickMs.value;
}
</script>

<template>
  <SettingsSection
    v-if="projectStore.projectSettings"
    :title="t('videoEditor.projectSettings.advanced')"
    :summary="t('videoEditor.projectSettings.advanced')"
  >
    <UiFormField
      :label="t('videoEditor.settings.audioDeclickDuration') + ' (ms)'"
      :help="
        t('videoEditor.settings.audioDeclickDurationHelp') +
        ' ' +
        t('videoEditor.settings.appDefaultHint', { value: defaultDeclickMs })
      "
      :resettable="isDifferentFromDefault"
      :reset-tooltip="t('videoEditor.settings.resetToAppDefault', { value: defaultDeclickMs })"
      @reset="resetToDefault"
    >
      <UiWheelNumberInput v-model="audioDeclickDurationMs" :min="0" :max="500" :step="1" />
    </UiFormField>
  </SettingsSection>
</template>
