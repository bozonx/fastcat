<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

function resetDefaults() {
  workspaceStore.userSettings.locale = DEFAULT_USER_SETTINGS.locale;
  workspaceStore.userSettings.openLastProjectOnStart = DEFAULT_USER_SETTINGS.openLastProjectOnStart;
  workspaceStore.userSettings.stopFrames.qualityPercent =
    DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userGeneral', 'General') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <UFormField :label="t('videoEditor.settings.uiLanguage', 'Interface language')">
      <USelectMenu
        v-model="workspaceStore.userSettings.locale"
        :items="[
          { label: 'English (US)', value: 'en-US' },
          { label: 'Русский (RU)', value: 'ru-RU' },
        ]"
        value-key="value"
        label-key="label"
        class="w-full"
        @update:model-value="(v: any) => (workspaceStore.userSettings.locale = v?.value ?? v)"
      />
    </UFormField>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="workspaceStore.userSettings.openLastProjectOnStart" />
      <span class="text-sm text-ui-text">
        {{ t('videoEditor.settings.openLastProjectOnStart', 'Open last project on start') }}
      </span>
    </label>

    <UFormField
      :label="t('videoEditor.settings.stopFramesQuality', 'Stop frame quality')"
      :help="t('videoEditor.settings.stopFramesQualityHint', 'WebP quality (1-100)')"
    >
      <WheelNumberInput
        v-model="workspaceStore.userSettings.stopFrames.qualityPercent"
        :min="1"
        :max="100"
        :step="1"
      />
    </UFormField>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
