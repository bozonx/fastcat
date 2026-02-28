<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-sm font-medium text-ui-text">
      {{ t('videoEditor.settings.userProject', 'Project defaults') }}
    </div>

    <MediaResolutionSettings
      v-model:width="workspaceStore.userSettings.projectDefaults.width"
      v-model:height="workspaceStore.userSettings.projectDefaults.height"
      v-model:fps="workspaceStore.userSettings.projectDefaults.fps"
      v-model:resolution-format="workspaceStore.userSettings.projectDefaults.resolutionFormat"
      v-model:orientation="workspaceStore.userSettings.projectDefaults.orientation"
      v-model:aspect-ratio="workspaceStore.userSettings.projectDefaults.aspectRatio"
      v-model:is-custom-resolution="
        workspaceStore.userSettings.projectDefaults.isCustomResolution
      "
      v-model:audio-channels="workspaceStore.userSettings.projectDefaults.audioChannels"
      v-model:sample-rate="workspaceStore.userSettings.projectDefaults.sampleRate"
      :disabled="false"
    />

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
