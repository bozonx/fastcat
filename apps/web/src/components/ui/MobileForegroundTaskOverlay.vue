<script setup lang="ts">
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useMobileLayout } from '~/composables/useMobileLayout';

const { t } = useI18n();
const backgroundTasksStore = useBackgroundTasksStore();
const { isMobileLayout } = useMobileLayout();

const visible = computed(() => isMobileLayout.value && backgroundTasksStore.hasActiveTasks);

function formatProgress(value: number): string {
  return `${Math.round(value * 100)}%`;
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      >
        <div
          class="w-[85vw] max-w-sm bg-ui-bg-elevated rounded-2xl border border-ui-border shadow-2xl p-5 flex flex-col gap-4"
        >
          <div class="text-center">
            <h3 class="text-lg font-semibold text-ui-text">
              {{ t('videoEditor.backgroundTasks.processing') }}
            </h3>
            <p class="text-sm text-ui-text-muted mt-1">
              {{ t('videoEditor.backgroundTasks.doNotClose') }}
            </p>
          </div>

          <div class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
            <div
              v-for="task in backgroundTasksStore.activeTasks"
              :key="task.id"
              class="flex flex-col gap-2 p-3 bg-ui-bg rounded-xl border border-ui-border"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-ui-text truncate pr-2" :title="task.title">{{
                  task.title
                }}</span>
                <span class="text-xs text-ui-text-muted shrink-0">{{
                  formatProgress(task.progress)
                }}</span>
              </div>

              <UProgress :value="task.progress * 100" size="sm" color="primary" />

              <div v-if="task.description" class="text-xs text-ui-text-muted">
                {{ task.description }}
              </div>

              <UButton
                v-if="task.cancel"
                size="xs"
                variant="ghost"
                color="neutral"
                class="self-start"
                @click="backgroundTasksStore.cancelTask(task.id)"
              >
                {{ t('common.cancel') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
