<script setup lang="ts">
import { ref } from 'vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';
import BackgroundTasksModal from './BackgroundTasksModal.vue';

const backgroundTasksStore = useBackgroundTasksStore();
const isModalOpen = ref(false);

const { t } = useI18n();
</script>

<template>
  <div class="relative flex items-center justify-center">
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      class="relative"
      :title="t('videoEditor.backgroundTasks.title', 'Background Tasks')"
      @click="isModalOpen = true"
    >
      <ProgressSpinner
        v-if="backgroundTasksStore.hasActiveTasks"
        :progress="backgroundTasksStore.globalProgress * 100"
        size="sm"
      />
      <UIcon
        v-else
        name="i-mdi-progress-helper"
        class="w-4 h-4 text-ui-text-muted"
      />
    </UButton>

    <BackgroundTasksModal v-model:open="isModalOpen" />
  </div>
</template>
