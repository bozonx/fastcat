<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
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
  workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve =
    DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve;

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
      :title="t('videoEditor.settings.resetGeneralSettingsConfirmTitle', 'Reset general settings?')"
      :description="t('videoEditor.settings.resetGeneralSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetGeneralDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="font-semibold text-ui-text">
        {{ t('videoEditor.settings.userGeneral', 'General') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <UFormField :label="t('videoEditor.settings.uiLanguage', 'Interface language')">
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
    </UFormField>

    <UFormField :label="t('videoEditor.settings.uiBaseFontSize', 'Base font size (px)')">
      <UiWheelNumberInput
        v-model="workspaceStore.userSettings.ui.baseFontSize"
        :min="10"
        :max="24"
        :step="1"
      />
    </UFormField>

    <UFormField>
      <label class="flex items-center gap-2 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.openLastProjectOnStart" />
        <span class="text-ui-text">
          {{ t('videoEditor.settings.openLastProjectOnStart', 'Open last project on start') }}
        </span>
      </label>
    </UFormField>

    <UFormField>
      <label class="flex items-center gap-2 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.deleteWithoutConfirmation" />
        <span class="text-ui-text">
          {{
            t('videoEditor.settings.deleteWithoutConfirmation', 'Delete items without confirmation')
          }}
        </span>
      </label>
    </UFormField>

    <UFormField
      :label="
        t('videoEditor.settings.defaultTransitionDuration', 'Default transition duration (s)')
      "
    >
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.timeline.defaultTransitionDurationUs / 1000000"
        :min="0.1"
        :max="10"
        :step="0.1"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultTransitionDurationUs = Math.round(
              v * 1000000,
            ))
        "
      />
    </UFormField>

    <div class="flex flex-col gap-6 pt-4 border-t border-ui-border">
      <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
        {{ t('videoEditor.settings.advancedSection', 'Advanced') }}
      </div>

      <UFormField
        :label="
          t('videoEditor.settings.defaultStaticClipDuration', 'Default static clip duration (s)')
        "
        :help="t('videoEditor.settings.defaultStaticClipDurationHint')"
      >
        <UiWheelNumberInput
          :model-value="workspaceStore.userSettings.timeline.defaultStaticClipDurationUs / 1000000"
          :min="0.1"
          :max="60"
          :step="0.1"
          @update:model-value="
            (v) =>
              (workspaceStore.userSettings.timeline.defaultStaticClipDurationUs = Math.round(
                v * 1000000,
              ))
          "
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.stopFramesQuality', 'Stop frame quality')"
        :help="t('videoEditor.settings.stopFramesQualityHint')"
      >
        <UiWheelNumberInput
          v-model="workspaceStore.userSettings.stopFrames.qualityPercent"
          :min="1"
          :max="100"
          :step="1"
        />
      </UFormField>

      <UFormField
        :label="t('videoEditor.settings.mediaTaskConcurrency', 'Media tasks concurrency')"
        :help="t('videoEditor.settings.mediaTaskConcurrencyHelp')"
      >
        <UiWheelNumberInput
          v-model="workspaceStore.userSettings.optimization.mediaTaskConcurrency"
          :min="1"
          :max="20"
          :step="1"
        />
      </UFormField>

      <label class="flex items-center gap-3 cursor-pointer">
        <UCheckbox v-model="workspaceStore.userSettings.deleteWithoutConfirmation" />
        <span class="text-ui-text">
          {{ t('videoEditor.settings.deleteWithoutConfirmation', 'Delete without confirmation') }}
        </span>
      </label>

      <UFormField
        :label="t('videoEditor.settings.defaultAudioFadeCurveTitle', 'Default Fade Curve')"
        :help="t('videoEditor.settings.defaultAudioFadeCurveHint')"
      >
        <div class="flex items-center gap-1 rounded bg-ui-bg p-1 w-fit">
          <UButton
            size="xs"
            :variant="
              workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve === 'logarithmic'
                ? 'solid'
                : 'ghost'
            "
            :color="
              workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve === 'logarithmic'
                ? 'primary'
                : 'neutral'
            "
            @click="
              workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve = 'logarithmic'
            "
          >
            Logarithmic
          </UButton>
          <UButton
            size="xs"
            :variant="
              workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve === 'linear'
                ? 'solid'
                : 'ghost'
            "
            :color="
              workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve === 'linear'
                ? 'primary'
                : 'neutral'
            "
            @click="workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve = 'linear'"
          >
            Linear
          </UButton>
        </div>
      </UFormField>

      <div class="flex items-center justify-between gap-3 pt-2">
        <div class="flex flex-col gap-0.5">
          <div class="font-medium text-ui-text">
            {{ t('videoEditor.settings.clearUiCache', 'Clear UI cache') }}
          </div>
          <div class="text-xs text-ui-text-muted">
            {{ t('videoEditor.settings.clearUiCacheDesc') }}
          </div>
        </div>
        <UButton size="xs" color="error" variant="soft" @click="clearCache">
          {{ t('videoEditor.settings.clearCacheAction', 'Clear cache') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
