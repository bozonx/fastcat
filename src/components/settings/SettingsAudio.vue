<script setup lang="ts">
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs =
    DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs;
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetAudioSettingsConfirmTitle', 'Reset audio settings?')"
      :description="
        t(
          'videoEditor.settings.resetAudioSettingsConfirmDesc',
          'This will restore all audio settings to their default values.',
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
        {{ t('videoEditor.settings.userAudio', 'Audio') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <div class="space-y-2 rounded border border-ui-border bg-ui-bg-elevated p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-ui-text">
            {{ t('videoEditor.settings.audioScrubbingTitle', 'Audio Scrubbing') }}
          </div>
          <div class="text-xs text-ui-text-muted">
            {{
              t(
                'videoEditor.settings.audioScrubbingHint',
                'Play audio while scrubbing the timeline.',
              )
            }}
          </div>
        </div>
        <USwitch v-model="workspaceStore.userSettings.projectDefaults.audioScrubbingEnabled" />
      </div>

      <div class="pt-3 border-t border-ui-border mt-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-ui-text">
              {{ t('videoEditor.settings.projectAudioDeclickTitle', 'Audio De-click Duration') }}
            </div>
            <div class="text-xs text-ui-text-muted">
              {{
                t(
                  'videoEditor.settings.projectAudioDeclickHint',
                  'Micro-fades (linear) applied to edges of all clips to eliminate clicks. 0 disables it.',
                )
              }}
            </div>
          </div>
          <div class="w-32">
            <UiWheelNumberInput
              :model-value="
                workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs / 1000
              "
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
    </div>
  </div>
</template>
