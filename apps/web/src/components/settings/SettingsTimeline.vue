<script setup lang="ts">
import { TICKS_PER_SECOND } from '~/utils/time';
import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import {
  DEFAULT_USER_SETTINGS,
  MAX_DEFAULT_FADE_DURATION_TICKS,
  MAX_DEFAULT_STATIC_CLIP_DURATION_TICKS,
  MAX_DEFAULT_TRANSITION_DURATION_TICKS,
  MIN_DEFAULT_DURATION_TICKS,
} from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetTimelineDefaults() {
  workspaceStore.userSettings.timeline.defaultAudioFadeDurationTicks =
    DEFAULT_USER_SETTINGS.timeline.defaultAudioFadeDurationTicks;
  workspaceStore.userSettings.timeline.defaultTransitionDurationTicks =
    DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationTicks;
  workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks =
    DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationTicks;
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
        :model-value="
          workspaceStore.userSettings.timeline.defaultAudioFadeDurationTicks / TICKS_PER_SECOND
        "
        :min="MIN_DEFAULT_DURATION_TICKS / TICKS_PER_SECOND"
        :max="MAX_DEFAULT_FADE_DURATION_TICKS / TICKS_PER_SECOND"
        :step="0.1"
        :wheel-step-multiplier="10"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultAudioFadeDurationTicks = Math.round(
              v * TICKS_PER_SECOND,
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
        :model-value="
          workspaceStore.userSettings.timeline.defaultTransitionDurationTicks / TICKS_PER_SECOND
        "
        :min="MIN_DEFAULT_DURATION_TICKS / TICKS_PER_SECOND"
        :max="MAX_DEFAULT_TRANSITION_DURATION_TICKS / TICKS_PER_SECOND"
        :step="0.1"
        :wheel-step-multiplier="10"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultTransitionDurationTicks = Math.round(
              v * TICKS_PER_SECOND,
            ))
        "
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.defaultStaticClipDuration')">
      <UiWheelNumberInput
        :model-value="
          workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks / TICKS_PER_SECOND
        "
        :min="MIN_DEFAULT_DURATION_TICKS / TICKS_PER_SECOND"
        :max="MAX_DEFAULT_STATIC_CLIP_DURATION_TICKS / TICKS_PER_SECOND"
        :step="0.1"
        :wheel-step-multiplier="10"
        @update:model-value="
          (v) =>
            (workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks = Math.round(
              v * TICKS_PER_SECOND,
            ))
        "
      />
    </UiFormField>
  </div>
</template>
