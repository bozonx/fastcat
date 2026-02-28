<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-sm font-medium text-ui-text">
      {{ t('videoEditor.settings.userGeneral', 'General') }}
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
        @update:model-value="
          (v: any) => (workspaceStore.userSettings.locale = v?.value ?? v)
        "
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
      <UInput
        v-model.number="workspaceStore.userSettings.stopFrames.qualityPercent"
        type="number"
        min="1"
        max="100"
        step="1"
      />
    </UFormField>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
