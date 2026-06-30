<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiScaleSlider from '~/components/ui/UiScaleSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiAccordion from '~/components/ui/UiAccordion.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetGeneralDefaults() {
  // Preserve the user's language choice during a general reset.
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
  workspaceStore.userSettings.history.maxMemoryMb = DEFAULT_USER_SETTINGS.history.maxMemoryMb;
  workspaceStore.userSettings.backup = { ...DEFAULT_USER_SETTINGS.backup };
  workspaceStore.userSettings.autosave = { ...DEFAULT_USER_SETTINGS.autosave };

  isResetConfirmOpen.value = false;
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

    <UiFormField
      v-if="workspaceStore.inDevelopmentFeaturesEnabled"
      :label="t('videoEditor.settings.uiInterfaceScale')"
    >
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

    <UiFormField :label="t('videoEditor.settings.defaultTransitionDuration')">
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

    <UiFormField :label="t('videoEditor.settings.defaultStaticClipDuration')">
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.timeline.defaultStaticClipDurationUs / 1000000"
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

    <UiFormField :label="t('videoEditor.settings.stopFramesQuality')">
      <UiScaleSlider
        :model-value="String(workspaceStore.userSettings.stopFrames.qualityPercent)"
        :options="[
          { label: '10%', value: '10' },
          { label: '20%', value: '20' },
          { label: '30%', value: '30' },
          { label: '40%', value: '40' },
          { label: '50%', value: '50' },
          { label: '60%', value: '60' },
          { label: '70%', value: '70' },
          { label: '80%', value: '80' },
          { label: '90%', value: '90' },
          { label: '100%', value: '100' },
        ]"
        @update:model-value="workspaceStore.userSettings.stopFrames.qualityPercent = Number($event)"
      />
    </UiFormField>

    <label class="flex items-center gap-3 cursor-pointer px-1">
      <UCheckbox v-model="workspaceStore.userSettings.deleteWithoutConfirmation" />
      <span class="text-ui-text">
        {{ t('videoEditor.settings.deleteWithoutConfirmation') }}
      </span>
    </label>

    <UiAccordion :title="t('videoEditor.settings.advancedSection')">
      <div class="flex flex-col gap-6 pt-2">
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

        <UiFormField :label="t('videoEditor.settings.historyMaxEntries')">
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.history.maxEntries"
            :min="1"
            :max="1000"
            :step="1"
            :wheel-step-multiplier="10"
          />
        </UiFormField>

        <UiFormField :label="t('videoEditor.settings.historyMaxMemory')">
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.history.maxMemoryMb"
            :min="16"
            :max="8192"
            :step="16"
            :wheel-step-multiplier="8"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.autosaveInterval')"
          :help="t('videoEditor.settings.autosaveIntervalHelp')"
        >
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.autosave.intervalMinutes"
            :min="1"
            :max="60"
            :step="1"
            :wheel-step-multiplier="5"
          />
        </UiFormField>

        <UiFormField
          :label="t('videoEditor.settings.backupCount')"
          :help="t('videoEditor.settings.backupCountHelp')"
        >
          <div class="flex items-center gap-4">
            <UiScaleSlider
              :model-value="workspaceStore.userSettings.backup.count"
              :min="0"
              :max="5"
              @update:model-value="workspaceStore.userSettings.backup.count = $event as number"
            />
            <UiWheelNumberInput
              v-model="workspaceStore.userSettings.backup.count"
              :min="0"
              :max="50"
              :step="1"
              :wheel-step-multiplier="5"
            />
          </div>
        </UiFormField>
      </div>
    </UiAccordion>
  </div>
</template>
