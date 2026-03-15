<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';
import BackgroundTasksButton from '~/components/file-manager/BackgroundTasksButton.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const { leaveProject } = useProjectActions();

const emit = defineEmits(['open-project-settings', 'open-editor-settings', 'open-export-modal']);

const menuItems = computed(() => [
  [
    {
      label: t('fastcat.timeline.properties.title'),
      icon: 'i-heroicons-adjustments-horizontal',
      onSelect: () => selectionStore.selectTimelineProperties(),
    },
    {
      label: t('videoEditor.projectSettings.title'),
      icon: 'ix:project-configuration',
      onSelect: () => emit('open-project-settings'),
    },
    {
      label: t('videoEditor.settings.workspaceSection'),
      icon: 'i-heroicons-cog-6-tooth',
      onSelect: () => emit('open-editor-settings'),
    },
  ],
]);
</script>

<template>
  <div
    class="flex items-center justify-between px-4 h-10 pt-1 bg-ui-bg-elevated border-b border-ui-border"
  >
    <div class="flex items-center gap-2 h-full flex-1 min-w-0">
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-arrow-left"
        class="shrink-0"
        to="/"
      />

      <div
        class="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-ui-bg-accent cursor-pointer transition-colors shrink-0"
        @click="$emit('open-project-settings')"
      >
        <span class="text-ui-text font-bold text-sm truncate max-w-[200px]">
          {{ projectStore.currentProjectName }}
        </span>
        <UIcon name="ix:project-configuration" class="w-4 h-4 text-ui-text-muted" />
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

      <!-- Window Switcher -->
      <div class="flex items-center bg-ui-bg/50 p-1 rounded-lg border border-ui-border gap-1 mr-2">
        <button
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="
            projectStore.currentView === 'files'
              ? 'bg-ui-bg-elevated text-primary-500 shadow-sm'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50'
          "
          @click="projectStore.goToFiles()"
        >
          {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
        </button>
        <button
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="
            projectStore.currentView === 'cut'
              ? 'bg-ui-bg-elevated text-primary-500 shadow-sm'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50'
          "
          @click="projectStore.goToCut()"
        >
          {{ t('videoEditor.timeline.tabs.cut', 'Cut') }}
        </button>
        <button
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="
            projectStore.currentView === 'sound'
              ? 'bg-ui-bg-elevated text-primary-500 shadow-sm'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50'
          "
          @click="projectStore.goToSound()"
        >
          {{ t('videoEditor.timeline.tabs.sound', 'Sound') }}
        </button>
        <button
          class="px-3 py-1 rounded text-sm font-medium transition-colors"
          :class="
            projectStore.currentView === 'export'
              ? 'bg-ui-bg-elevated text-primary-500 shadow-sm'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50'
          "
          @click="projectStore.goToExport()"
        >
          {{ t('videoEditor.export.title', 'Export') }}
        </button>
      </div>

      <BackgroundTasksButton size="sm" />

      <UDropdownMenu :items="menuItems" mode="hover" :ui="{ content: 'w-56' }">
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-ellipsis-horizontal"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>

