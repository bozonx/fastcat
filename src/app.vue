<script setup lang="ts">
import BackgroundTaskToasts from '~/components/file-manager/BackgroundTaskToasts.vue';
// import RemoteFileExchangeModal from '~/components/file-manager/RemoteFileExchangeModal.vue';
import DesktopMediaReplaceModal from '~/components/timeline/DesktopMediaReplaceModal.vue';
import MobileMediaPickerDrawer from '~/components/timeline/MobileMediaPickerDrawer.vue';
import { usePresetsStore } from '~/stores/presets.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';

const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const route = useRoute();
const isMobileLayout = computed(() => route.path === '/m' || route.path.startsWith('/m/'));

const colorMode = useColorMode();
const presetsStore = usePresetsStore();

// Load presets on startup
onMounted(() => {
  presetsStore.load();
  window.addEventListener('contextmenu', (e) => e.preventDefault());
});

const workspaceStore = useWorkspaceStore();

// Apply interface scale dynamically
watchEffect(() => {
  if (typeof document !== 'undefined' && workspaceStore.userSettings?.ui?.interfaceScale) {
    document.documentElement.style.fontSize = `${workspaceStore.userSettings.ui.interfaceScale}px`;
  }
});

/**
 * Handle initial color mode preference.
 * Defaults to dark but allows user to change it if we add a theme switcher later.
 */
if (colorMode.preference === 'system') {
  colorMode.preference = 'dark';
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <BackgroundTaskToasts />
    <!-- <RemoteFileExchangeModal /> -->
    <DesktopMediaReplaceModal v-if="!isMobileLayout" />
    <MobileMediaPickerDrawer 
      v-if="isMobileLayout" 
      :is-open="uiStore.isMediaReplaceModalOpen" 
      :is-replace-mode="true"
      @close="uiStore.isMediaReplaceModalOpen = false" 
    />
  </UApp>
</template>

<style>
/* Global styles that might be needed in app.vue */
html,
body,
#__nuxt {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

body {
  background-color: var(--ui-bg);
  color: var(--ui-text);
}
</style>
