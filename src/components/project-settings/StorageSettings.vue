<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';

const { t } = useI18n();
const projectStore = useProjectStore();

const emit = defineEmits<{
  clearTemp: [];
  deleteProject: [];
}>();
</script>

<template>
  <div v-if="projectStore.projectSettings" class="space-y-4">
    <h3 class="text-lg font-semibold text-ui-text">
      {{ t('videoEditor.projectSettings.storage', 'Storage') }}
    </h3>

    <div class="space-y-3">
      <!-- Clear Vardata -->
      <div class="flex items-center justify-between gap-3 p-3 rounded border border-ui-border">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="font-medium text-ui-text">
            {{ t('videoEditor.projectSettings.clearTemp', 'Clear temporary files') }}
          </div>
          <div class="text-sm text-ui-text-muted">
            {{
              t(
                'videoEditor.projectSettings.clearTempHint',
                'Removes all files from vardata for this project',
              )
            }}
          </div>
        </div>

        <UButton
          color="warning"
          variant="soft"
          icon="i-heroicons-trash"
          :disabled="!projectStore.currentProjectId"
          :label="t('videoEditor.projectSettings.clearTempAction', 'Clear')"
          @click="emit('clearTemp')"
        />
      </div>

      <!-- Delete Project -->
      <div
        class="flex items-center justify-between gap-3 p-3 rounded border border-error-500/20 bg-error-500/5"
      >
        <div class="flex flex-col gap-1 min-w-0">
          <div class="font-medium text-error-400">
            {{ t('videoEditor.projectSettings.deleteProject', 'Delete Project') }}
          </div>
          <div class="text-sm text-error-400/70">
            {{
              t(
                'videoEditor.projectSettings.deleteProjectConfirmDescription',
                'Permanently delete project folder and all its content',
              )
            }}
          </div>
        </div>

        <UButton
          color="error"
          variant="solid"
          icon="i-heroicons-trash"
          :label="t('videoEditor.projectSettings.deleteProjectAction', 'Delete')"
          @click="emit('deleteProject')"
        />
      </div>
    </div>
  </div>
</template>
