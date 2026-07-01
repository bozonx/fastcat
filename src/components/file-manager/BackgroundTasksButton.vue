<script setup lang="ts">
import { computed } from 'vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import BackgroundTasksModal from './BackgroundTasksModal.vue';

withDefaults(
  defineProps<{
    showLabel?: boolean;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  }>(),
  {
    size: 'xs',
  },
);

const backgroundTasksStore = useBackgroundTasksStore();
const uiStore = useUiStore();

const modalOpen = computed({
  get: () => uiStore.isBackgroundTasksOpen,
  set: (value: boolean) => {
    uiStore.isBackgroundTasksOpen = value;
  },
});

const { t } = useI18n();
</script>

<template>
  <div class="relative flex items-center justify-center">
    <UButton
      variant="ghost"
      color="neutral"
      :size="size"
      class="relative"
      :title="t('videoEditor.backgroundTasks.title')"
      @click="void (modalOpen = true)"
    >
      <UiProgressSpinner
        v-if="backgroundTasksStore.hasActiveTasks"
        :progress="backgroundTasksStore.globalProgress * 100"
        size="sm"
      />
      <UIcon v-else name="i-mdi-progress-helper" class="w-4 h-4 text-ui-text-muted" />
    </UButton>

    <BackgroundTasksModal v-model:open="modalOpen" />
  </div>
</template>
