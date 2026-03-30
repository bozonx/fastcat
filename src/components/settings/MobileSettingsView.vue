<script setup lang="ts">
import { ref, computed } from 'vue';
import UiTabs from '~/components/ui/UiTabs.vue';
import SettingsSnapping from './SettingsSnapping.vue';
import ResolutionSettings from '~/components/project-settings/ResolutionSettings.vue';
import ExportSettings from '~/components/project-settings/ExportSettings.vue';
import AdvancedSettings from '~/components/project-settings/AdvancedSettings.vue';
import MetadataSettings from '~/components/project-settings/MetadataSettings.vue';
import StorageSettings from '~/components/project-settings/StorageSettings.vue';
import SettingsGeneral from './SettingsGeneral.vue';
import SettingsVideo from './SettingsVideo.vue';
import SettingsAudio from './SettingsAudio.vue';
import SettingsStorage from './SettingsStorage.vue';
import SettingsOptimization from './SettingsOptimization.vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore, type ToolbarDragMode } from '~/stores/timeline-settings.store';

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineSettingsStore = useTimelineSettingsStore();

const activeTab = ref('quick');

const tabOptions = computed(() => [
  { value: 'quick', label: t('videoEditor.settings.quick') },
  { value: 'timeline', label: t('videoEditor.settings.timeline') },
  { value: 'project', label: t('videoEditor.settings.project') },
  { value: 'app', label: t('videoEditor.settings.app') },
]);

const moveModeOptions = computed(() => [
  { value: 'none' as const, label: t('fastcat.timeline.overlayModeNone'), icon: 'i-heroicons-cursor-arrow-rays' },
  { value: 'pseudo_overlap' as const, label: t('fastcat.timeline.overlayModePseudo'), icon: 'i-heroicons-rectangle-stack' },
  { value: 'slip' as const, label: t('fastcat.timeline.slipMode'), icon: 'i-heroicons-arrows-right-left' },
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
    <div class="px-4 border-b border-ui-border shrink-0 bg-ui-bg-elevated pt-2">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-bold text-ui-text">{{ t('navigation.settings') }}</h2>
      </div>
      <UiTabs v-model="activeTab" :options="tabOptions" />
    </div>

    <!-- Active Tab Content -->
    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar lg:p-6 bg-ui-bg">
      <!-- Quick Settings -->
      <div v-if="activeTab === 'quick'" class="space-y-8 animate-in fade-in duration-200">
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
      </div>

      <!-- Timeline Settings -->
      <div v-else-if="activeTab === 'timeline'" class="space-y-8 animate-in fade-in duration-200">
        <SettingsOptimization />
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
        <div v-else class="flex flex-col items-center justify-center py-20 text-ui-text-muted gap-3">
           <UIcon name="lucide:folder-off" class="w-10 h-10 opacity-20" />
           <p class="text-sm">Settings not available</p>
        </div>
      </div>

      <!-- App Settings -->
      <div v-else-if="activeTab === 'app'" class="space-y-8 pb-10 animate-in fade-in duration-200">
        <SettingsGeneral />
        <div class="h-px bg-ui-border"></div>
        <SettingsVideo />
        <div class="h-px bg-ui-border"></div>
        <SettingsAudio />
        <div class="h-px bg-ui-border"></div>
        <SettingsStorage />
      </div>
    </div>
  </div>
</template>
