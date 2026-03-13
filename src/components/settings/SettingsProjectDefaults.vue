<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import {
  createDefaultProjectPresets,
  createProjectPresetId,
  resolveProjectPreset,
} from '~/utils/settings';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const isResetConfirmOpen = ref(false);

const presetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

const selectedPreset = computed(() =>
  resolveProjectPreset(workspaceStore.userSettings.projectPresets),
);

function resetDefaults() {
  workspaceStore.userSettings.projectPresets = createDefaultProjectPresets();
  isResetConfirmOpen.value = false;
}

function addPreset() {
  const basePreset = selectedPreset.value;
  const preset = {
    ...basePreset,
    id: createProjectPresetId(),
    name: `${basePreset.name} Copy`,
  };

  workspaceStore.userSettings.projectPresets.items.push(preset);
  workspaceStore.userSettings.projectPresets.selectedPresetId = preset.id;
}

function removePreset() {
  const { items, selectedPresetId } = workspaceStore.userSettings.projectPresets;
  if (items.length <= 1) return;

  const index = items.findIndex((preset) => preset.id === selectedPresetId);
  if (index === -1) return;

  items.splice(index, 1);
  const nextPreset = items[Math.max(0, index - 1)] ?? items[0];
  if (!nextPreset) return;

  workspaceStore.userSettings.projectPresets.selectedPresetId = nextPreset.id;

  if (workspaceStore.userSettings.projectPresets.lastUsedPresetId === selectedPresetId) {
    workspaceStore.userSettings.projectPresets.lastUsedPresetId = nextPreset.id;
  }
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
        {{ t('videoEditor.settings.userProject', 'Project presets') }}
      </div>
      <div class="flex items-center gap-2">
        <UButton size="xs" color="neutral" variant="ghost" @click="addPreset">
          {{ t('common.create', 'Create') }}
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="workspaceStore.userSettings.projectPresets.items.length <= 1"
          @click="removePreset"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" @click="isResetConfirmOpen = true">
          {{ t('videoEditor.settings.resetDefaults', 'Reset to defaults') }}
        </UButton>
      </div>
    </div>

    <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
      <USelectMenu
        v-model="workspaceStore.userSettings.projectPresets.selectedPresetId"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        class="w-full"
      />
    </UFormField>

    <UFormField :label="t('common.name', 'Name')">
      <UInput v-model="selectedPreset.name" class="w-full" />
    </UFormField>

    <MediaResolutionSettings
      v-model:width="selectedPreset.width"
      v-model:height="selectedPreset.height"
      v-model:fps="selectedPreset.fps"
      v-model:resolution-format="selectedPreset.resolutionFormat"
      v-model:orientation="selectedPreset.orientation"
      v-model:aspect-ratio="selectedPreset.aspectRatio"
      v-model:is-custom-resolution="selectedPreset.isCustomResolution"
      v-model:sample-rate="selectedPreset.sampleRate"
      :disabled="false"
    />

    <div class="text-xs text-ui-text-muted">
      {{ t('videoEditor.settings.userSavedNote', 'Saved to .gran/user.settings.json') }}
    </div>
  </div>
</template>
