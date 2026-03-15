<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { clearUiCache } from '~/stores/ui/uiLocalStorage';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const settingsStore = useTimelineSettingsStore();

const isResetConfirmOpen = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.locale = DEFAULT_USER_SETTINGS.locale;
  workspaceStore.userSettings.openLastProjectOnStart = DEFAULT_USER_SETTINGS.openLastProjectOnStart;
  workspaceStore.userSettings.stopFrames.qualityPercent =
    DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;
  workspaceStore.userSettings.timeline.snapThresholdPx =
    DEFAULT_USER_SETTINGS.timeline.snapThresholdPx;
  isResetConfirmOpen.value = false;
}

function clearCache() {
  clearUiCache();
  window.location.reload();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetGeneralSettingsConfirmTitle', 'Reset general settings?')"
      :description="
        t(
          'videoEditor.settings.resetGeneralSettingsConfirmDesc',
          'This will restore all general settings to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction', 'Reset')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userGeneral', 'General') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
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
      :label="t('videoEditor.settings.snapThresholdDefault', 'Snap threshold default (px)')"
    >
      <div class="flex items-center gap-4">
        <WheelSlider
          :model-value="workspaceStore.userSettings.timeline.snapThresholdPx"
          :min="1"
          :max="100"
          :step="1"
          class="flex-1"
          @update:model-value="settingsStore.setGlobalSnapThresholdPx"
        />
        <div class="text-xs font-mono text-ui-text-muted w-8 text-right">
          {{ workspaceStore.userSettings.timeline.snapThresholdPx }}
        </div>
      </div>
    </UFormField>

    <UFormField
      :label="
        t('videoEditor.settings.defaultTransitionDuration', 'Default transition duration (s)')
      "
    >
      <WheelNumberInput
        :model-value="
          workspaceStore.userSettings.timeline.defaultTransitionDurationUs / 1000000
        "
        :min="0.1"
        :max="10"
        :step="0.1"
        @update:model-value="
          (v) => (workspaceStore.userSettings.timeline.defaultTransitionDurationUs = Math.round(v * 1000000))
        "
      />
    </UFormField>

    <div class="flex flex-col gap-4 pt-4 border-t border-ui-border">
      <div class="text-xs font-semibold text-ui-text-muted uppercase tracking-wide">
        {{ t('videoEditor.settings.advancedSection', 'Advanced') }}
      </div>

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

      <UFormField
        :label="t('videoEditor.settings.mediaTaskConcurrency', 'Media tasks concurrency')"
        :help="t('videoEditor.settings.mediaTaskConcurrencyHelp')"
      >
        <WheelNumberInput
          v-model="workspaceStore.userSettings.optimization.mediaTaskConcurrency"
          :min="1"
          :max="20"
          :step="1"
        />
      </UFormField>

      <div class="flex items-center justify-between gap-3 pt-2">
        <div class="flex flex-col gap-0.5">
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.clearUiCache', 'Clear UI cache') }}
          </div>
          <div class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.clearUiCacheDesc',
                'Resets layout, panel sizes, and other UI preferences.',
              )
            }}
          </div>
        </div>
        <UButton size="xs" color="error" variant="soft" @click="clearCache">
          {{ t('videoEditor.settings.clearCacheAction', 'Clear cache') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
