<script setup lang="ts">
import { ref, computed } from 'vue';
import SettingsSnapping from '~/components/timeline/TimelineSnapSettings.vue';
import MobileAppSettingsPanel from './MobileAppSettingsPanel.vue';
import TimelineProperties from '~/components/properties/TimelineProperties.vue';
import ResolutionSettings from '~/components/project-settings/ResolutionSettings.vue';
import ExportSettings from '~/components/project-settings/ExportSettings.vue';
import AdvancedSettings from '~/components/project-settings/AdvancedSettings.vue';
import MetadataSettings from '~/components/project-settings/MetadataSettings.vue';
import StorageSettings from '~/components/project-settings/StorageSettings.vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineSettingsStore, type ToolbarDragMode } from '~/stores/timeline-settings.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const timelineSettingsStore = useTimelineSettingsStore();
const fileManager = useFileManager();

const currentTimelineFsEntry = computed(() => {
  const path = projectStore.currentTimelinePath;
  if (!path) return null;
  const entry = fileManager.findEntryByPath(path);
  if (entry && entry.kind === 'file') return entry;
  return {
    name: path.split('/').pop() || 'Timeline.otio',
    path,
    kind: 'file' as const,
    source: 'local' as const,
  };
});

const activeTab = ref('timeline');

const tabOptions = computed(() => [
  { value: 'timeline', label: t('videoEditor.settings.timeline') },
  { value: 'project', label: t('videoEditor.settings.project') },
  { value: 'app', label: t('videoEditor.settings.app') },
]);

const moveModeOptions = computed(() => [
  {
    value: 'none' as const,
    label: t('fastcat.timeline.overlayModeNone'),
    icon: 'i-heroicons-cursor-arrow-rays',
  },
  {
    value: 'pseudo_overlap' as const,
    label: t('fastcat.timeline.overlayModePseudo'),
    icon: 'i-heroicons-rectangle-stack',
  },
  {
    value: 'slip' as const,
    label: t('fastcat.timeline.slipMode'),
    icon: 'i-heroicons-arrows-right-left',
  },
]);

const currentMoveMode = computed({
  get: () => {
    if (!timelineSettingsStore.toolbarDragModeEnabled) return 'none' as const;
    return timelineSettingsStore.toolbarDragMode;
  },
  set: (val: 'none' | ToolbarDragMode) => {
    if (val === 'none') {
      timelineSettingsStore.toolbarDragModeEnabled = false;
    } else {
      timelineSettingsStore.selectToolbarDragMode(val);
    }
  },
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-ui-bg">
    <!-- Header with Tabs -->
    <div class="px-4 shrink-0 bg-ui-bg-elevated">
      <div class="flex items-center py-4">
        <h2 class="text-sm font-medium text-ui-text-muted truncate">
          {{ projectStore.currentProjectName || t('navigation.settings') }}
        </h2>
      </div>
      <UTabs v-model="activeTab" :items="tabOptions" variant="link" :content="false" />
    </div>

    <!-- Tab Content: timeline and project use a shared scrollable container -->
    <div
      v-if="activeTab !== 'app'"
      class="flex-1 overflow-y-auto p-4 custom-scrollbar lg:p-6 bg-ui-bg"
    >
      <!-- Timeline Settings -->
      <div v-if="activeTab === 'timeline'" class="space-y-8 animate-in fade-in duration-200">
        <section>
          <h4 class="text-xs font-bold uppercase tracking-wider text-ui-text-muted mb-4 px-1">
            {{ t('fastcat.timeline.moveMode') }}
          </h4>
          <div class="grid grid-cols-1 gap-2">
            <UButton
              v-for="opt in moveModeOptions"
              :key="opt.value"
              :variant="currentMoveMode === opt.value ? 'solid' : 'soft'"
              :color="currentMoveMode === opt.value ? 'primary' : 'neutral'"
              :icon="opt.icon"
              class="justify-start px-4 h-11 rounded-xl"
              @click="currentMoveMode = opt.value"
            >
              {{ opt.label }}
            </UButton>
          </div>
        </section>

        <div class="h-px bg-ui-border"></div>

        <SettingsSnapping />

        <div class="h-px bg-ui-border"></div>

        <section class="space-y-4">
          <h4 class="text-xs font-bold uppercase tracking-wider text-ui-text-muted mb-4 px-1">
            {{ t('videoEditor.settings.advancedSection') }}
          </h4>
          <UiFormField :label="t('videoEditor.settings.defaultTransitionDuration')">
            <UiWheelNumberInput
              :model-value="
                workspaceStore.userSettings.timeline.defaultTransitionDurationUs / 1_000_000
              "
              :min="0.1"
              :max="10"
              :step="0.1"
              :wheel-step-multiplier="10"
              @update:model-value="
                (v: number) =>
                  (workspaceStore.userSettings.timeline.defaultTransitionDurationUs = Math.round(
                    v * 1_000_000,
                  ))
              "
            />
          </UiFormField>
          <UiFormField
            :label="t('videoEditor.settings.defaultStaticClipDuration')"
            :help="t('videoEditor.settings.defaultStaticClipDurationHint')"
          >
            <UiWheelNumberInput
              :model-value="
                workspaceStore.userSettings.timeline.defaultStaticClipDurationUs / 1_000_000
              "
              :min="0.1"
              :max="60"
              :step="0.1"
              :wheel-step-multiplier="10"
              @update:model-value="
                (v: number) =>
                  (workspaceStore.userSettings.timeline.defaultStaticClipDurationUs = Math.round(
                    v * 1_000_000,
                  ))
              "
            />
          </UiFormField>
        </section>

        <div class="h-px bg-ui-border"></div>

        <TimelineProperties :fs-entry="currentTimelineFsEntry" />
      </div>

      <!-- Project Settings -->
      <div v-else-if="activeTab === 'project'" class="space-y-6 animate-in fade-in duration-200">
        <div v-if="projectStore.projectSettings" class="space-y-8">
          <ResolutionSettings />
          <div class="h-px bg-ui-border"></div>
          <ExportSettings />
          <div class="h-px bg-ui-border"></div>
          <AdvancedSettings />
          <div class="h-px bg-ui-border"></div>
          <MetadataSettings />
          <div class="h-px bg-ui-border"></div>
          <StorageSettings />
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center py-20 text-ui-text-muted gap-3"
        >
          <UIcon name="lucide:folder-off" class="w-10 h-10 opacity-20" />
          <p class="text-sm">Settings not available</p>
        </div>
      </div>
    </div>

    <!-- App Settings: full-height panel with its own internal tab navigation -->
    <MobileAppSettingsPanel v-else class="flex-1 min-h-0 animate-in fade-in duration-200" />
  </div>
</template>

<style scoped>
/* Override UTabs active tab color to use selection-accent instead of primary */
:deep([data-state='active']) {
  color: var(--selection-accent-400) !important;
}
</style>
