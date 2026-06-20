<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import SettingsGeneral from './SettingsGeneral.vue';
import SettingsOptimization from './SettingsOptimization.vue';
import SettingsExportDefaults from './SettingsExportDefaults.vue';
import SettingsVideo from './SettingsVideo.vue';
import SettingsAudio from './SettingsAudio.vue';
import SettingsIntegrations from './SettingsIntegrations.vue';
import SettingsStorage from './SettingsStorage.vue';
import SettingsUi from './SettingsUi.vue';
import { useUiStore } from '~/stores/ui.store';

type SettingsSection =
  | 'user.general'
  | 'user.proxy'
  | 'user.export'
  | 'user.video'
  | 'user.audio'
  | 'user.integrations'
  | 'user.ui'
  | 'workspace.storage';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const uiStore = useUiStore();

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'user.general',
  'user.proxy',
  'user.export',
  'user.video',
  'user.audio',
  'user.integrations',
  'user.ui',
  'workspace.storage',
];

function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

const savedSection = uiStore.editorSettingsActiveSection;
const activeSection = ref<SettingsSection>(
  savedSection === 'user.project' || !isSettingsSection(savedSection)
    ? 'user.general'
    : savedSection,
);

watch(activeSection, (section) => {
  uiStore.editorSettingsActiveSection = section;
});

const sections = computed(() => [
  { value: 'user.general', label: t('videoEditor.settings.userGeneral') },
  { value: 'user.proxy', label: t('videoEditor.settings.userProxy') },
  { value: 'user.export', label: t('videoEditor.settings.userExport') },
  { value: 'user.video', label: t('videoEditor.settings.userVideo') },
  { value: 'user.audio', label: t('videoEditor.settings.userAudio') },
  { value: 'user.integrations', label: t('videoEditor.settings.userIntegrations') },
  { value: 'user.ui', label: t('videoEditor.settings.userUi') },
  { value: 'workspace.storage', label: t('videoEditor.settings.workspaceStorage') },
]);

onBeforeUnmount(() => {
  workspaceStore.flushSettingsSaves();
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-ui-bg">
    <!-- Horizontal scrollable tab navigation -->
    <div
      class="shrink-0 overflow-x-auto bg-ui-bg-elevated border-b border-ui-border [scrollbar-width:none]"
    >
      <UTabs
        v-model="activeSection"
        :items="sections"
        variant="link"
        :content="false"
        class="min-w-max px-4"
      />
    </div>

    <!-- Section content -->
    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <SettingsGeneral v-if="activeSection === 'user.general'" />
      <SettingsOptimization v-else-if="activeSection === 'user.proxy'" />
      <SettingsExportDefaults
        v-else-if="activeSection === 'user.export'"
        :is-active="activeSection === 'user.export'"
      />
      <SettingsVideo v-else-if="activeSection === 'user.video'" />
      <SettingsAudio v-else-if="activeSection === 'user.audio'" />
      <SettingsIntegrations v-else-if="activeSection === 'user.integrations'" />
      <SettingsUi v-else-if="activeSection === 'user.ui'" />
      <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
    </div>
  </div>
</template>
