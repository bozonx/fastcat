<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const isResetConfirmOpen = ref(false);

const thumbnailModeOptions = computed(() => [
  { label: t('videoEditor.settings.clipThumbnailModeStandard'), value: 'standard' },
  { label: t('videoEditor.settings.clipThumbnailModeEdges'), value: 'edges' },
  { label: t('videoEditor.settings.clipThumbnailModeNone'), value: 'none' },
]);

const waveformModeOptions = computed(() => [
  { label: t('videoEditor.settings.defaultAudioWaveformModeHalf'), value: 'half' },
  { label: t('videoEditor.settings.defaultAudioWaveformModeFull'), value: 'full' },
  { label: t('videoEditor.settings.defaultAudioWaveformModeNone'), value: 'none' },
]);

function resetDefaults() {
  workspaceStore.userSettings.ui = { ...DEFAULT_USER_SETTINGS.ui };
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.settings.resetUiSettingsConfirmTitle')"
      :description="t('videoEditor.settings.resetUiSettingsConfirmDesc')"
      :confirm-text="t('videoEditor.settings.hotkeysResetAllConfirmAction')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetDefaults"
    />

    <div class="flex items-center justify-between gap-3 px-1">
      <div class="font-semibold text-ui-text">
        {{ t('videoEditor.settings.userUi') }}
      </div>
      <UButton size="xs" color="neutral" variant="ghost" @click="void (isResetConfirmOpen = true)">
        {{ t('videoEditor.settings.resetDefaults') }}
      </UButton>
    </div>

    <UiFormField :label="t('videoEditor.settings.clipThumbnailMode')">
      <UiSelect
        v-model="workspaceStore.userSettings.ui.clipThumbnailMode"
        :items="thumbnailModeOptions"
        value-key="value"
        label-key="label"
        full-width
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.settings.defaultAudioWaveformMode')">
      <UiSelect
        v-model="workspaceStore.userSettings.ui.defaultAudioWaveformMode"
        :items="waveformModeOptions"
        value-key="value"
        label-key="label"
        full-width
      />
    </UiFormField>
  </div>
</template>
