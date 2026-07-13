<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import {
  DEFAULT_USER_SETTINGS,
  MAX_DEFAULT_FADE_DURATION_US,
  MAX_DEFAULT_STATIC_CLIP_DURATION_US,
  MAX_DEFAULT_TRANSITION_DURATION_US,
  MIN_DEFAULT_DURATION_US,
} from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetTimelineDefaults() {
  workspaceStore.userSettings.timeline.defaultAudioFadeDurationUs =
    DEFAULT_USER_SETTINGS.timeline.defaultAudioFadeDurationUs;
  workspaceStore.userSettings.timeline.defaultTransitionDurationUs =
    DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs;
  workspaceStore.userSettings.timeline.defaultStaticClipDurationUs =
    DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationUs;
  workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve =
    DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve;

  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetTimelineSettingsConfirmTitle')"
      :description="t('videoEditor.settings.resetTimelineSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetTimelineDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="font-semibold text-ui-text">
        {{ t('videoEditor.settings.userTimeline') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="void (isResetConfirmOpen = true)">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <UiFormField :label="t('videoEditor.settings.defaultAudioFadeDuration')">
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.timeline.defaultAudioFadeDurationUs / 1000000"
        :min="MIN_DEFAULT_DURATION_US / 1000000"
        :max="MAX_DEFAULT_FADE_DURATION_US / 1000000"
        :step="0.1"
        :wheel-step-multiplier="10"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultAudioFadeDurationUs = Math.round(
              v * 1000000,
            ))
        "
      />
    </UiFormField>

    <UiFormField
      :label="t('videoEditor.settings.defaultAudioFadeCurveTitle')"
      :help="t('videoEditor.settings.defaultAudioFadeCurveHint')"
    >
      <UiButtonGroup
        v-model="workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve"
        :options="[
          { label: t('fastcat.clip.audioFade.curve.linear'), value: 'linear' },
          {
            label: t('fastcat.clip.audioFade.curve.logarithmic'),
            value: 'logarithmic',
          },
        ]"
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.defaultTransitionDuration')">
      <UiWheelNumberInput
        :model-value="workspaceStore.userSettings.timeline.defaultTransitionDurationUs / 1000000"
        :min="MIN_DEFAULT_DURATION_US / 1000000"
        :max="MAX_DEFAULT_TRANSITION_DURATION_US / 1000000"
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
        :min="MIN_DEFAULT_DURATION_US / 1000000"
        :max="MAX_DEFAULT_STATIC_CLIP_DURATION_US / 1000000"
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
  </div>
</template>
