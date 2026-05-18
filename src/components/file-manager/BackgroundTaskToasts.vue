<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

const backgroundTasksStore = useBackgroundTasksStore();
// Watching only the `completedTasks` collection prevents this component from
// re-running on every progress update of every running task.
const { completedTasks } = storeToRefs(backgroundTasksStore);
const { t } = useI18n();
const toast = useToast();

const notifiedCompletedTaskIds = new Set<string>();

watch(completedTasks, (nextCompleted) => {
  const completedIds = new Set(nextCompleted.map((task) => task.id));
  for (const taskId of notifiedCompletedTaskIds) {
    if (!completedIds.has(taskId)) {
      notifiedCompletedTaskIds.delete(taskId);
    }
  }

  for (const task of nextCompleted) {
    if (notifiedCompletedTaskIds.has(task.id)) continue;
    // Cancellations are user-initiated and should not raise a toast.
    if (task.status === 'cancelled') {
      notifiedCompletedTaskIds.add(task.id);
      continue;
    }

    if (task.status === 'failed') {
      toast.add({
        title: t('videoEditor.backgroundTasks.failed'),
        description: task.error || task.title,
        color: 'error',
      });
      notifiedCompletedTaskIds.add(task.id);
      continue;
    }

    if (task.type === 'conversion') {
      toast.add({
        title: t('videoEditor.fileManager.convert.success'),
        description: task.title,
        color: 'success',
      });
      notifiedCompletedTaskIds.add(task.id);
      continue;
    }

    if (task.type === 'proxy') {
      toast.add({
        title: t('videoEditor.fileManager.proxy.success'),
        description: task.title,
        color: 'success',
      });
      notifiedCompletedTaskIds.add(task.id);
    }
  }
});
</script>

<template>
  <div class="hidden" />
</template>
