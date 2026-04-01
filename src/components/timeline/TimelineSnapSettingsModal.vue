<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { storeToRefs } from 'pinia';
import TimelineSnapSettings from './TimelineSnapSettings.vue';

const settingsStore = useTimelineSettingsStore();
const { isSnapSettingsModalOpen: isOpen } = storeToRefs(settingsStore);

const { t } = useI18n();
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.snappingTitle', 'Snapping')"
    :ui="{
      content: 'sm:max-w-lg',
    }"
  >
    <div class="px-6 py-4">
      <TimelineSnapSettings />
    </div>
  </UiModal>
</template>
