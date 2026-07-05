<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import SettingsSection from './SettingsSection.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const audioDeclickDurationMs = computed({
  get: () => (projectStore.projectSettings?.project.audioDeclickDurationUs || 0) / 1000,
  set: (val: number) => {
    if (projectStore.projectSettings) {
      projectStore.projectSettings.project.audioDeclickDurationUs = val * 1000;
    }
  },
});

const defaultDeclickMs = computed(() => {
  const us = workspaceStore.userSettings?.projectDefaults?.audioDeclickDurationUs;
  return (us !== undefined ? us : 5_000) / 1000;
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
    >
      <div class="flex items-center gap-2">
        <UiWheelNumberInput v-model="audioDeclickDurationMs" :min="0" :max="500" :step="1" />
        <UiTooltip
          v-if="isDifferentFromDefault"
          :text="t('videoEditor.settings.resetToAppDefault', { value: defaultDeclickMs })"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-path"
            class="reset-declick-btn"
            :aria-label="t('videoEditor.settings.resetToAppDefault', { value: defaultDeclickMs })"
            @click="resetToDefault"
          />
        </UiTooltip>
      </div>
    </UiFormField>
  </SettingsSection>
</template>
