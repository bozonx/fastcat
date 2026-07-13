<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiScaleSlider from '~/components/ui/UiScaleSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiAccordion from '~/components/ui/UiAccordion.vue';
import { isTauriRuntime } from '~/utils/runtime';
import { useMobileLayout } from '~/composables/useMobileLayout';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { isMobileLayout } = useMobileLayout();

// Undo depth is only user-configurable on desktop; the web build pins it and the
// snapshot memory budget is an internal cap on both (see history.store.ts).
const isDesktop = isTauriRuntime();

const isResetConfirmOpen = ref(false);

function resetGeneralDefaults() {
  // Preserve the user's language choice during a general reset.
  workspaceStore.userSettings.openLastProjectOnStart = DEFAULT_USER_SETTINGS.openLastProjectOnStart;

  // Reset ui section
  workspaceStore.userSettings.ui = { ...DEFAULT_USER_SETTINGS.ui };

  // Reset other specific fields shown in this form
  workspaceStore.userSettings.stopFrames.qualityPercent =
    DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;
  workspaceStore.userSettings.deleteWithoutConfirmation =
    DEFAULT_USER_SETTINGS.deleteWithoutConfirmation;
  workspaceStore.userSettings.history.maxEntries = DEFAULT_USER_SETTINGS.history.maxEntries;
  workspaceStore.userSettings.backup = { ...DEFAULT_USER_SETTINGS.backup };
  workspaceStore.userSettings.autosave = { ...DEFAULT_USER_SETTINGS.autosave };

  isResetConfirmOpen.value = false;
}

const stopFramesQualityOptions = [
  { label: '50', value: '50' },
  { label: '55', value: '55' },
  { label: '60', value: '60' },
  { label: '65', value: '65' },
  { label: '70', value: '70' },
  { label: '75', value: '75' },
  { label: '80', value: '80' },
  { label: '85', value: '85' },
  { label: '90', value: '90' },
  { label: '95', value: '95' },
  { label: '100', value: '100' },
];
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
      <UButton size="xs" color="neutral" variant="ghost" @click="void (isResetConfirmOpen = true)">
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
      <UiScaleSlider
        v-model="workspaceStore.userSettings.ui.interfaceScale"
        :min="10"
        :max="20"
        :default-value="14"
      />
    </UiFormField>

    <UiFormField>
      <label class="flex items-center justify-between gap-3 cursor-pointer select-none w-full">
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.openLastProjectOnStart') }}
        </span>
        <USwitch v-model="workspaceStore.userSettings.openLastProjectOnStart" />
      </label>
    </UiFormField>

    <UiFormField>
      <label class="flex items-center justify-between gap-3 cursor-pointer select-none w-full">
        <span class="text-sm text-ui-text">
          {{ t('videoEditor.settings.deleteWithoutConfirmation') }}
        </span>
        <USwitch v-model="workspaceStore.userSettings.deleteWithoutConfirmation" />
      </label>
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.stopFramesQuality')">
      <div class="flex items-center gap-4 w-full">
        <UiScaleSlider
          :model-value="String(workspaceStore.userSettings.stopFrames.qualityPercent)"
          :options="stopFramesQualityOptions"
          with-input
          :default-value="85"
          @update:model-value="
            workspaceStore.userSettings.stopFrames.qualityPercent = Number($event)
          "
        />
        <UiWheelNumberInput
          v-model="workspaceStore.userSettings.stopFrames.qualityPercent"
          :min="20"
          :max="100"
          :step="1"
          :wheel-step-multiplier="5"
          class="w-24!"
        />
        <span class="text-xs text-ui-text-muted whitespace-nowrap">%</span>
      </div>
    </UiFormField>

    <UiAccordion :title="t('videoEditor.settings.advancedSection')">
      <div class="flex flex-col gap-6 pt-2">
        <UiFormField v-if="isDesktop" :label="t('videoEditor.settings.historyMaxEntries')">
          <UiWheelNumberInput
            v-model="workspaceStore.userSettings.history.maxEntries"
            :min="1"
            :max="1000"
            :step="1"
            :wheel-step-multiplier="10"
          />
        </UiFormField>

        <UiFormField
          v-if="!isMobileLayout"
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

        <template v-if="workspaceStore.inDevelopmentFeaturesEnabled">
          <UiFormField>
            <label
              class="flex items-center justify-between gap-3 cursor-pointer select-none w-full"
            >
              <span class="text-sm text-ui-text">
                {{ t('videoEditor.settings.useBackups') }}
              </span>
              <USwitch v-model="workspaceStore.userSettings.backup.enabled" />
            </label>
          </UiFormField>

          <UiFormField
            v-if="workspaceStore.userSettings.backup.enabled"
            :label="t('videoEditor.settings.backupCount')"
            :help="t('videoEditor.settings.backupCountHelp')"
          >
            <div class="flex items-center gap-4">
              <UiScaleSlider
                :model-value="workspaceStore.userSettings.backup.count"
                :min="1"
                :max="10"
                with-input
                :default-value="5"
                @update:model-value="workspaceStore.userSettings.backup.count = $event as number"
              />
              <UiWheelNumberInput
                v-model="workspaceStore.userSettings.backup.count"
                :min="1"
                :max="50"
                :step="1"
                :wheel-step-multiplier="5"
              />
            </div>
          </UiFormField>
        </template>
      </div>
    </UiAccordion>
  </div>
</template>
