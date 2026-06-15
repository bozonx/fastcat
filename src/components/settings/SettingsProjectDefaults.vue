<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const presetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userProject') }}
      </div>
    </div>

    <UiFormField :label="t('videoEditor.export.presetLabel')">
      <UiSelect
        v-model="workspaceStore.userSettings.projectPresets.selectedPresetId"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        full-width
      />
    </UiFormField>
  </div>
</template>
