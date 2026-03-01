<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { leaveProject } = useProjectActions();

defineEmits(['open-project-settings', 'open-editor-settings', 'open-export-modal']);
</script>

<template>
  <div
    class="flex items-center justify-between px-4 py-2.5 bg-ui-bg-elevated border-b border-ui-border"
  >
    <div class="flex items-center gap-2 h-full flex-1 min-w-0">
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-left"
        class="shrink-0"
        @click="leaveProject"
      />

      <div
        class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-ui-bg-accent cursor-pointer transition-colors shrink-0"
        @click="$emit('open-project-settings')"
      >
        <span class="text-ui-text font-bold text-sm truncate max-w-[200px]">
          {{ projectStore.currentProjectName }}
        </span>
        <UIcon name="i-heroicons-pencil-square-20-solid" class="w-4 h-4 text-ui-text-muted" />
      </div>

      <!-- Timeline Tabs -->
      <TimelineTabs />
    </div>

    <div class="flex items-center gap-2">
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-uturn-left"
        :disabled="!timelineStore.historyStore.canUndo"
        :title="t('common.undo') + ' (Ctrl+Z)'"
        @click="timelineStore.undoTimeline()"
      />
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-uturn-right"
        :disabled="!timelineStore.historyStore.canRedo"
        :title="t('common.redo') + ' (Ctrl+Shift+Z)'"
        @click="timelineStore.redoTimeline()"
      />

      <div class="w-px h-4 bg-ui-border mx-1" />

      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-cog-6-tooth"
        :title="t('videoEditor.settings.title', 'Editor settings')"
        @click="$emit('open-editor-settings')"
      />
      <UButton
        size="sm"
        variant="soft"
        color="primary"
        icon="i-heroicons-arrow-down-tray"
        :disabled="timelineStore.duration <= 0"
        :label="t('videoEditor.export.confirm', 'Export')"
        @click="$emit('open-export-modal')"
      />
    </div>
  </div>
</template>
