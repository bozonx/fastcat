<script setup lang="ts">
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs =
    DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs;
  workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled =
    DEFAULT_USER_SETTINGS.projectDefaults.audioScrubbingEnabled;
  workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve =
    DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve;
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetAudioSettingsConfirmTitle')"
      :description="
        t(
          'videoEditor.settings.resetAudioSettingsConfirmDesc',
          'This will restore all audio settings to their default values.',
        )
      "
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userAudio') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <UiFormField
      :label="t('videoEditor.settings.audioScrubbingTitle')"
      :help="
        t('videoEditor.settings.audioScrubbingHint')
      "
    >
      <USwitch v-model="workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled" />
    </UiFormField>

    <UiFormField
      :label="t('videoEditor.settings.defaultAudioFadeCurveTitle')"
      :help="
        t(
          'videoEditor.settings.defaultAudioFadeCurveHint',
          'Default curve used for audio fades when you manually create a fade. (De-click always uses a short linear fade).',
        )
      "
    >
      <UiButtonGroup
        v-model="workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve"
        :options="[
          {
            label: t('fastcat.clip.audioFade.curve.logarithmic'),
            value: 'logarithmic',
          },
          { label: t('fastcat.clip.audioFade.curve.linear'), value: 'linear' },
        ]"
      />
    </UiFormField>

    <UiFormField
      :label="
        t('videoEditor.settings.projectAudioDeclickTitle') + ' (ms)'
      "
      :help="
        t(
          'videoEditor.settings.projectAudioDeclickHint',
          'Micro-fades (linear) applied to edges of all clips to eliminate clicks. 0 disables it.',
        )
      "
    >
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs / 1000"
        size="sm"
        :step="1"
        :min="0"
        :max="1000"
        @update:model-value="
          (value: number) =>
            (workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs = Math.round(
              Math.max(0, Math.min(1000, Number(value) || 0)) * 1000,
            ))
        "
      />
    </UiFormField>
  </div>
</template>
