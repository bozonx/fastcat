<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const { t } = useI18n();
const backgroundTasksStore = useBackgroundTasksStore();

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}
</script>

<template>
  <UiModal
    :open="open"
    :title="t('videoEditor.backgroundTasks.title', 'Background Tasks')"
    size="3xl"
    @update:open="emit('update:open', $event)"
  >
    <template #header-actions>
      <UButton
        v-if="backgroundTasksStore.completedTasks.length > 0"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-trash"
        :label="t('common.clear', 'Clear')"
        @click="backgroundTasksStore.clearCompletedTasks()"
      />
    </template>

    <div class="flex flex-col gap-4 p-4 min-h-75 max-h-[70vh] overflow-y-auto">
      <div
        v-if="backgroundTasksStore.tasks.length === 0"
        class="text-center text-ui-text-muted py-8"
      >
        {{ t('videoEditor.backgroundTasks.empty', 'No background tasks') }}
      </div>

      <div v-else class="flex flex-col gap-2">
        <div
          v-for="task in backgroundTasksStore.sortedTasks"
          :key="task.id"
          class="flex items-center gap-4 p-3 bg-ui-bg-elevated border border-ui-border rounded-lg"
        >
          <!-- Status Icon / Progress -->
          <div class="w-8 flex justify-center shrink-0">
            <UiProgressSpinner
              v-if="task.status === 'running' || task.status === 'pending'"
              :progress="task.progress * 100"
              size="sm"
            />
            <UIcon
              v-else-if="task.status === 'completed'"
              name="i-heroicons-check-circle"
              class="text-success-500 w-6 h-6"
            />
            <UIcon
              v-else-if="task.status === 'failed'"
              name="i-heroicons-x-circle"
              class="text-error-500 w-6 h-6"
            />
            <UIcon
              v-else-if="task.status === 'cancelled'"
              name="i-heroicons-minus-circle"
              class="text-ui-text-muted w-6 h-6"
            />
          </div>

          <!-- Task Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm truncate">{{ task.title }}</span>
              <span class="text-xs text-ui-text-muted">{{ formatTime(task.createdAt) }}</span>
            </div>
            <div v-if="task.error" class="text-xs text-error-500 mt-1 line-clamp-1">
              {{ task.error }}
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 shrink-0">
            <UButton
              v-if="task.status === 'running' || task.status === 'pending'"
              icon="i-heroicons-x-mark"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="t('common.cancel', 'Cancel')"
              @click="backgroundTasksStore.cancelTask(task.id)"
            />
            <UButton
              v-else
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="t('common.remove', 'Remove')"
              @click="backgroundTasksStore.removeTask(task.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </UiModal>
</template>
