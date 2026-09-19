<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import SettingsGeneral from './SettingsGeneral.vue';
import SettingsOptimization from './SettingsOptimization.vue';
import SettingsVideo from './SettingsVideo.vue';
import SettingsAudio from './SettingsAudio.vue';
import SettingsIntegrations from './SettingsIntegrations.vue';
import SettingsStorage from './SettingsStorage.vue';
import SettingsUi from './SettingsUi.vue';
import { useUiStore } from '~/stores/ui.store';
import { isEmbedRuntime } from '~/utils/embed-runtime';

type SettingsSection =
  | 'user.general'
  | 'user.proxy'
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
  'user.ui',
  'user.proxy',
  'user.video',
  'user.audio',
  'user.integrations',
  'workspace.storage',
];

// An embedded session keeps only what it hands its host
// (`utils/embed/synced-settings.ts`). Storage and integrations belong to the
// host, and engine tuning would quietly reset with every session.
const EMBED_SETTINGS_SECTIONS: readonly SettingsSection[] = ['user.general', 'user.ui'];

const availableSections = isEmbedRuntime() ? EMBED_SETTINGS_SECTIONS : SETTINGS_SECTIONS;

function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && (availableSections as readonly string[]).includes(value);
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

const SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  'user.general': 'videoEditor.settings.userGeneral',
  'user.ui': 'videoEditor.settings.userUi',
  'user.proxy': 'videoEditor.settings.userProxy',
  'user.video': 'videoEditor.settings.userVideo',
  'user.audio': 'videoEditor.settings.userAudio',
  'user.integrations': 'videoEditor.settings.userIntegrations',
  'workspace.storage': 'videoEditor.settings.workspaceStorage',
};

const sections = computed(() =>
  availableSections.map((value) => ({ value, label: t(SECTION_LABEL_KEYS[value]) })),
);

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
      <SettingsVideo v-else-if="activeSection === 'user.video'" />
      <SettingsAudio v-else-if="activeSection === 'user.audio'" />
      <SettingsIntegrations v-else-if="activeSection === 'user.integrations'" />
      <SettingsUi v-else-if="activeSection === 'user.ui'" />
      <SettingsStorage v-else-if="activeSection === 'workspace.storage'" />
    </div>
  </div>
</template>
