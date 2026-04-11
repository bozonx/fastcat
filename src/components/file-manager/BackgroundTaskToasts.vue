<script setup lang="ts">
import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

const backgroundTasksStore = useBackgroundTasksStore();
const { tasks } = storeToRefs(backgroundTasksStore);
const { t } = useI18n();
const toast = useToast();

const notifiedCompletedTaskIds = new Set<string>();

watch(
  tasks,
  (nextTasks) => {
    const activeTaskIds = new Set(nextTasks.map((task) => task.id));

    for (const taskId of notifiedCompletedTaskIds) {
      if (!activeTaskIds.has(taskId)) {
        notifiedCompletedTaskIds.delete(taskId);
      }
    }

    for (const task of nextTasks) {
      if (task.status !== 'completed' || notifiedCompletedTaskIds.has(task.id)) {
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
  },
  { deep: true },
);
</script>

<template>
  <div class="hidden" />
</template>
