<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';
import BackgroundTasksButton from '~/components/file-manager/BackgroundTasksButton.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const { getHotkeyTitle } = useHotkeyLabel();

defineEmits(['open-project-settings', 'open-editor-settings', 'open-export-modal']);
</script>

<template>
  <div
    class="flex items-center justify-between px-2 h-10 bg-ui-bg-elevated border-b border-ui-border"
  >
    <div class="flex items-center gap-2 h-full flex-1 min-w-0">
      <UiActionButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-home"
        class="shrink-0"
        to="/"
      />

      <span
        class="text-ui-text font-bold text-sm truncate max-w-[200px] cursor-pointer hover:text-white transition-colors shrink-0"
        :title="projectStore.currentProjectName ?? ''"
        @click="$emit('open-project-settings')"
      >
        {{ projectStore.currentProjectName }}
      </span>

      <!-- Project Actions Toolbar -->
      <div class="flex items-center gap-1 shrink-0">
        <UiTooltip
          :text="getHotkeyTitle(t('videoEditor.projectSettings.title'), 'general.projectSettings')"
        >
          <UiActionButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="ix:project-configuration"
            @click="$emit('open-project-settings')"
          />
        </UiTooltip>

        <UiTooltip :text="getHotkeyTitle(t('common.save'), 'general.save')">
          <UiActionButton
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="timelineStore.isSavingTimeline ? 'i-heroicons-arrow-path' : 'i-lucide-save'"
            :disabled="timelineStore.isSavingTimeline || !timelineStore.timelineDoc"
            :class="[
              timelineStore.isSavingTimeline ? 'animate-spin' : '',
              !timelineStore.isSavingTimeline && timelineStore.isTimelineDirty
                ? 'text-selection-accent-500 hover:text-selection-accent-400'
                : '',
            ]"
            @click="timelineStore.saveTimeline()"
          />
        </UiTooltip>

        <BackgroundTasksButton v-if="workspaceStore.inDevelopmentFeaturesEnabled" size="sm" />

        <UiTooltip
          :text="getHotkeyTitle(t('videoEditor.settings.workspaceSection'), 'general.appSettings')"
        >
          <UiActionButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            @click="$emit('open-editor-settings')"
          />
        </UiTooltip>
      </div>

      <!-- Timeline Tabs -->
      <TimelineTabs />
    </div>

    <div class="flex items-center gap-2">
      <UiTooltip :text="getHotkeyTitle(t('common.undo'), 'general.undo')">
        <UiActionButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-uturn-left"
          :disabled="!timelineStore.historyStore.canUndo('timeline')"
          @click="timelineStore.undoTimeline()"
        />
      </UiTooltip>
      <UiTooltip :text="getHotkeyTitle(t('common.redo'), 'general.redo')">
        <UiActionButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-uturn-right"
          :disabled="!timelineStore.historyStore.canRedo('timeline')"
          @click="timelineStore.redoTimeline()"
        />
      </UiTooltip>

      <!-- Window Switcher -->
      <div
        class="flex items-stretch bg-ui-bg rounded-md border border-ui-border divide-x divide-ui-border overflow-hidden mr-2 h-8"
      >
        <UiTooltip
          v-if="workspaceStore.inDevelopmentFeaturesEnabled"
          :text="getHotkeyTitle(t('videoEditor.fileManager.tabs.files'), 'general.switchViewFiles')"
        >
          <button
            class="px-4 h-full flex items-center text-xs font-bold uppercase tracking-wider transition-colors"
            :class="
              projectStore.currentView === 'files'
                ? 'bg-ui-bg-accent text-selection-accent-400 font-bold'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover/30'
            "
            @click="projectStore.goToFiles()"
          >
            {{ t('videoEditor.fileManager.tabs.files') }}
          </button>
        </UiTooltip>
        <UiTooltip
          :text="getHotkeyTitle(t('videoEditor.timeline.tabs.cut'), 'general.switchViewCut')"
        >
          <button
            class="px-4 h-full flex items-center text-xs font-bold uppercase tracking-wider transition-colors"
            :class="
              projectStore.currentView === 'cut'
                ? 'bg-ui-bg-accent text-selection-accent-400 font-bold'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover/30'
            "
            @click="projectStore.goToCut()"
          >
            {{ t('videoEditor.timeline.tabs.cut') }}
          </button>
        </UiTooltip>
        <UiTooltip
          v-if="workspaceStore.inDevelopmentFeaturesEnabled"
          :text="getHotkeyTitle(t('videoEditor.timeline.tabs.sound'), 'general.switchViewSound')"
        >
          <button
            class="px-4 h-full flex items-center text-xs font-bold uppercase tracking-wider transition-colors"
            :class="
              projectStore.currentView === 'sound'
                ? 'bg-ui-bg-accent text-selection-accent-400 font-bold'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover/30'
            "
            @click="projectStore.goToSound()"
          >
            {{ t('videoEditor.timeline.tabs.sound') }}
          </button>
        </UiTooltip>
        <UiTooltip
          :text="getHotkeyTitle(t('videoEditor.export.title'), 'general.switchViewExport')"
        >
          <button
            data-testid="nav-export"
            class="px-4 h-full flex items-center text-xs font-bold uppercase tracking-wider transition-colors relative"
            :class="
              projectStore.currentView === 'export'
                ? 'bg-ui-bg-accent text-selection-accent-400 font-bold'
                : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover/30'
            "
            @click="projectStore.goToExport()"
          >
            {{ t('videoEditor.export.title') }}
          </button>
        </UiTooltip>
      </div>
    </div>
  </div>
</template>
