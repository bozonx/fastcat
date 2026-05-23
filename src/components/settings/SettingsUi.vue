<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const thumbnailModeOptions = computed(() => [
  { label: t('videoEditor.settings.clipThumbnailModeStandard'), value: 'standard' },
  { label: t('videoEditor.settings.clipThumbnailModeEdges'), value: 'edges' },
  { label: t('videoEditor.settings.clipThumbnailModeNone'), value: 'none' },
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="font-semibold text-ui-text px-1">
      {{ t('videoEditor.settings.userUi') }}
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
  </div>
</template>
