<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import SettingsGeneral from './SettingsGeneral.vue';
import SettingsOptimization from './SettingsOptimization.vue';
import SettingsProjectDefaults from './SettingsProjectDefaults.vue';
import SettingsExportDefaults from './SettingsExportDefaults.vue';
import SettingsVideo from './SettingsVideo.vue';
import SettingsAudio from './SettingsAudio.vue';
import SettingsIntegrations from './SettingsIntegrations.vue';
import SettingsStorage from './SettingsStorage.vue';

type SettingsSection =
  | 'user.general'
  | 'user.proxy'
  | 'user.project'
  | 'user.export'
  | 'user.video'
  | 'user.audio'
  | 'user.integrations'
  | 'workspace.storage';

const STORAGE_KEY = 'fastcat:settings:active-section';
const EXPIRATION_MS = 24 * 60 * 60 * 1000;

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

function getStoredSection(): SettingsSection {
  if (typeof window === 'undefined') return 'user.general';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'user.general';
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > EXPIRATION_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return 'user.general';
    }
    return parsed.section as SettingsSection;
  } catch {
    return 'user.general';
  }
}

const activeSection = ref<SettingsSection>(getStoredSection());

watch(activeSection, (section) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ section, timestamp: Date.now() }));
  } catch {
    // ignore
  }
});

const sections = computed(() => [
  { value: 'user.general', label: t('videoEditor.settings.userGeneral') },
  { value: 'user.proxy', label: t('videoEditor.settings.userProxy') },
  { value: 'user.project', label: t('videoEditor.settings.userProject') },
  { value: 'user.export', label: t('videoEditor.settings.userExport') },
  { value: 'user.video', label: t('videoEditor.settings.userVideo') },
  { value: 'user.audio', label: t('videoEditor.settings.userAudio') },
  { value: 'user.integrations', label: t('videoEditor.settings.userIntegrations') },
  { value: 'workspace.storage', label: t('videoEditor.settings.workspaceStorage') },
]);

onBeforeUnmount(() => {
  workspaceStore.flushSettingsSaves();
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-ui-bg">
    <!-- Horizontal scrollable tab navigation -->
    <div class="shrink-0 overflow-x-auto bg-ui-bg-elevated border-b border-ui-border [scrollbar-width:none]">
      <UTabs
        v-model="activeSection"
        :items="sections"
        variant="link"
        :content="false"
        class="min-w-max px-4"
      />
    </div>

    <!-- Section content -->
    <div class="flex-1 overflow-y-auto p-4 custom-scrollbar lg:p-6">
      <SettingsGeneral v-if="activeSection === 'user.general'" />
      <SettingsOptimization v-else-if="activeSection === 'user.proxy'" />
      <SettingsProjectDefaults v-else-if="activeSection === 'user.project'" />
      <SettingsExportDefaults
        v-else-if="activeSection === 'user.export'"
        :is-active="activeSection === 'user.export'"
      />
      <SettingsVideo v-else-if="activeSection === 'user.video'" />
      <SettingsAudio v-else-if="activeSection === 'user.audio'" />
      <SettingsIntegrations v-else-if="activeSection === 'user.integrations'" />
      <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
    </div>
  </div>
</template>
