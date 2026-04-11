<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';

import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiScaleSlider from '~/components/ui/UiScaleSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiAccordion from '~/components/ui/UiAccordion.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { clearUiCache } from '~/stores/ui/uiLocalStorage';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const settingsStore = useTimelineSettingsStore();

const isResetConfirmOpen = ref(false);

function resetGeneralDefaults() {
  workspaceStore.userSettings.locale = DEFAULT_USER_SETTINGS.locale;
  workspaceStore.userSettings.openLastProjectOnStart = DEFAULT_USER_SETTINGS.openLastProjectOnStart;

  // Reset timeline section
  workspaceStore.userSettings.timeline = { ...DEFAULT_USER_SETTINGS.timeline };

  // Reset ui section
  workspaceStore.userSettings.ui = { ...DEFAULT_USER_SETTINGS.ui };

  // Reset other specific fields shown in this form
  workspaceStore.userSettings.stopFrames.qualityPercent =
    DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;
  workspaceStore.userSettings.optimization.mediaTaskConcurrency =
    DEFAULT_USER_SETTINGS.optimization.mediaTaskConcurrency;
  workspaceStore.userSettings.deleteWithoutConfirmation =
    DEFAULT_USER_SETTINGS.deleteWithoutConfirmation;
  workspaceStore.userSettings.history.maxEntries = DEFAULT_USER_SETTINGS.history.maxEntries;
  workspaceStore.userSettings.backup = { ...DEFAULT_USER_SETTINGS.backup };

  isResetConfirmOpen.value = false;
}

function clearCache() {
  clearUiCache();
  window.location.reload();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetGeneralSettingsConfirmTitle')"
      :description="t('videoEditor.settings.resetGeneralSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetGeneralDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="font-semibold text-ui-text">
        {{ t('videoEditor.settings.userGeneral') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <UiFormField :label="t('videoEditor.settings.uiLanguage')">
      <UiSelect
        v-model="workspaceStore.userSettings.locale"
        :items="[
          { label: 'English (US)', value: 'en-US' },
          { label: 'Русский (RU)', value: 'ru-RU' },
        ]"
        value-key="value"
        label-key="label"
        full-width
        @update:model-value="
          (v: unknown) =>
            (workspaceStore.userSettings.locale = ((v as { value: string })?.value ?? v) as
              | 'en-US'
              | 'ru-RU')
        "
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.uiInterfaceScale')">
      <UiScaleSlider v-model="workspaceStore.userSettings.ui.interfaceScale" :min="10" :max="20" />
    </UiFormField>

    <UiFormField>
      <label class="flex items-center gap-2 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.openLastProjectOnStart" />
        <span class="text-ui-text">
          {{ t('videoEditor.settings.openLastProjectOnStart') }}
        </span>
      </label>
    </UiFormField>

    <UiFormField
      :label="
        t('videoEditor.settings.defaultTransitionDuration')
      "
    >
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.timeline.defaultTransitionDurationUs / 1000000"
        :min="0.1"
        :max="10"
        :step="0.1"
        :wheel-step-multiplier="10"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultTransitionDurationUs = Math.round(
              v * 1000000,
            ))
        "
      />
    </UiFormField>

    <UiAccordion :title="t('videoEditor.settings.advancedSection')">
      <div class="flex flex-col gap-6 pt-2">
        <UiFormField
          :label="
            t('videoEditor.settings.defaultStaticClipDuration')
          "
          :help="t('videoEditor.settings.defaultStaticClipDurationHint')"
        >
          <UiWheelNumberInput
            :model-value="
              workspaceStore.userSettings.timeline.defaultStaticClipDurationUs / 1000000
            "
            :min="0.1"
            :max="60"
            :step="0.1"
            :wheel-step-multiplier="10"
            @update:model-value="
              (v) =>
                (workspaceStore.userSettings.timeline.defaultStaticClipDurationUs = Math.round(
                  v * 1000000,
                ))
            "
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.stopFramesQuality')"
          :help="t('videoEditor.settings.stopFramesQualityHint')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.stopFrames.qualityPercent"
            :min="1"
            :max="100"
            :step="1"
            :wheel-step-multiplier="10"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.mediaTaskConcurrency')"
          :help="t('videoEditor.settings.mediaTaskConcurrencyHelp')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.optimization.mediaTaskConcurrency"
            :min="1"
            :max="20"
            :step="1"
            :wheel-step-multiplier="5"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.historyMaxEntries')"
          :help="t('videoEditor.settings.historyMaxEntriesHelp')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.history.maxEntries"
            :min="1"
            :max="1000"
            :step="1"
            :wheel-step-multiplier="10"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.backupInterval')"
          :help="t('videoEditor.settings.backupIntervalHelp')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.backup.intervalMinutes"
            :min="0"
            :max="120"
            :step="1"
            :wheel-step-multiplier="5"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.backupCount')"
          :help="t('videoEditor.settings.backupCountHelp')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.backup.count"
            :min="1"
            :max="50"
            :step="1"
            :wheel-step-multiplier="5"
          />
        </UiFormField>

        <label class="flex items-center gap-3 cursor-pointer">
          <UCheckbox v-model="workspaceStore.userSettings.deleteWithoutConfirmation" />
          <span class="text-ui-text">
            {{ t('videoEditor.settings.deleteWithoutConfirmation') }}
          </span>
        </label>

        <div class="flex items-center justify-between gap-3 pt-2">
          <div class="flex flex-col gap-0.5">
            <div class="font-medium text-ui-text">
              {{ t('videoEditor.settings.clearUiCache') }}
            </div>
            <div class="text-xs text-ui-text-muted">
              {{ t('videoEditor.settings.clearUiCacheDesc') }}
            </div>
          </div>
          <UButton size="xs" color="error" variant="soft" @click="clearCache">
            {{ t('videoEditor.settings.clearCacheAction') }}
          </UButton>
        </div>
      </div>
    </UiAccordion>
  </div>
</template>
