<script setup lang="ts">
import { ref, computed } from 'vue';
import MobileAppSettingsPanel from './MobileAppSettingsPanel.vue';
import ResolutionSettings from '~/components/project-settings/ResolutionSettings.vue';
import ExportSettings from '~/components/project-settings/ExportSettings.vue';
import AdvancedSettings from '~/components/project-settings/AdvancedSettings.vue';
import MetadataSettings from '~/components/project-settings/MetadataSettings.vue';
import StorageSettings from '~/components/project-settings/StorageSettings.vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const props = defineProps<{
  hideTitle?: boolean;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const activeTab = ref(projectStore.currentProjectName ? 'project' : 'app');

const tabOptions = computed(() => {
  const options = [];
  if (projectStore.currentProjectName) {
    options.push({ value: 'project', label: t('videoEditor.settings.project') });
  }
  options.push({ value: 'app', label: t('videoEditor.settings.app') });
  return options;
});

</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-ui-bg">
    <!-- Header with Tabs -->
    <div class="px-4 shrink-0 bg-ui-bg-elevated">
      <div v-if="!props.hideTitle" class="flex items-center py-4">
        <h2 class="text-sm font-medium text-ui-text-muted truncate">
          {{ projectStore.currentProjectName || t('navigation.settings') }}
        </h2>
      </div>
      <UTabs v-model="activeTab" :items="tabOptions" variant="link" :content="false" />
    </div>

    <!-- Project Settings -->
    <div v-if="activeTab === 'project'" class="flex-1 overflow-y-auto p-4 custom-scrollbar bg-ui-bg animate-in fade-in duration-200">
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
