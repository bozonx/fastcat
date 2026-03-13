<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import { createDefaultProjectDefaults } from '~/utils/settings/helpers';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

function resetDefaults() {
  workspaceStore.userSettings.projectDefaults = createDefaultProjectDefaults();
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="
        t('videoEditor.settings.resetProjectDefaultSettingsConfirmTitle', 'Reset project defaults?')
      "
      :description="
        t(
          'videoEditor.settings.resetProjectDefaultSettingsConfirmDesc',
          'This will restore all project default settings to their default values.',
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
        {{ t('videoEditor.settings.userProject', 'Project defaults') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
        {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
      </UButton>
    </div>

    <MediaResolutionSettings
      v-model:width="workspaceStore.userSettings.projectDefaults.width"
      v-model:height="workspaceStore.userSettings.projectDefaults.height"
      v-model:fps="workspaceStore.userSettings.projectDefaults.fps"
      v-model:resolution-format="workspaceStore.userSettings.projectDefaults.resolutionFormat"
      v-model:orientation="workspaceStore.userSettings.projectDefaults.orientation"
      v-model:aspect-ratio="workspaceStore.userSettings.projectDefaults.aspectRatio"
      v-model:is-custom-resolution="workspaceStore.userSettings.projectDefaults.isCustomResolution"
      v-model:audio-channels="workspaceStore.userSettings.projectDefaults.audioChannels"
      v-model:sample-rate="workspaceStore.userSettings.projectDefaults.sampleRate"
      :disabled="false"
    />

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
