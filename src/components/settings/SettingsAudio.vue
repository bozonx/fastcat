<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs = 5_000;
  workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve = 'logarithmic';
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userAudio', 'Audio') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="resetDefaults">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="space-y-2 rounded border border-ui-border bg-ui-bg-elevated p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.projectAudioDeclickTitle', 'Audio De-click Duration') }}
          </div>
          <div class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.projectAudioDeclickHint',
                'Default linear fade in/out applied to all audio and video clips. 0 disables it.',
              )
            }}
          </div>
        </div>
        <div class="w-32">
          <WheelNumberInput
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
        </div>
      </div>
    </div>

    <div class="space-y-2 rounded border border-ui-border bg-ui-bg-elevated p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.defaultAudioFadeCurveTitle', 'Default Fade Curve') }}
          </div>
          <div class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.defaultAudioFadeCurveHint',
                'Default curve used for audio fades when transition duration is automatically computed.',
              )
            }}
          </div>
        </div>
        <div class="flex items-center gap-1 rounded bg-ui-bg p-1">
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
            @click="workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve = 'logarithmic'"
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
      </div>
    </div>

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
