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
import {
  readLocalStorageJson,
  writeLocalStorageJson,
  removeLocalStorageKey,
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';

type SettingsSection =
  | 'user.general'
  | 'user.proxy'
  | 'user.project'
  | 'user.export'
  | 'user.video'
  | 'user.audio'
  | 'user.integrations'
  | 'workspace.storage';

const EXPIRATION_MS = 24 * 60 * 60 * 1000;

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

function getStoredSection(): SettingsSection {
  const parsed = readLocalStorageJson<{ section: SettingsSection; timestamp: number } | null>(
    STORAGE_KEYS.SETTINGS.ACTIVE_SECTION,
    null,
  );

  if (!parsed) return 'user.general';

  if (Date.now() - parsed.timestamp > EXPIRATION_MS) {
    removeLocalStorageKey(STORAGE_KEYS.SETTINGS.ACTIVE_SECTION);
    return 'user.general';
  }

  return parsed.section;
}

const activeSection = ref<SettingsSection>(getStoredSection());

watch(activeSection, (section) => {
  writeLocalStorageJson(STORAGE_KEYS.SETTINGS.ACTIVE_SECTION, {
    section,
    timestamp: Date.now(),
  });
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
