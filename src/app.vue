<script setup lang="ts">
import BackgroundTaskToasts from '~/components/file-manager/BackgroundTaskToasts.vue';
// import RemoteFileExchangeModal from '~/components/file-manager/RemoteFileExchangeModal.vue';
import DesktopMediaReplaceModal from '~/components/timeline/DesktopMediaReplaceModal.vue';
import RecoveryDialog from '~/components/timeline/RecoveryDialog.vue';
import CloseConfirmDialog from '~/components/timeline/CloseConfirmDialog.vue';
import MobileMediaPickerDrawer from '~/components/timeline/MobileMediaPickerDrawer.vue';
import MobileForegroundTaskOverlay from '~/components/ui/MobileForegroundTaskOverlay.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import { usePresetsStore } from '~/stores/presets.store';
import { useConfirmClose } from '~/composables/useConfirmClose';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { useDismissMenusOnEscape } from '~/composables/useDismissMenusOnEscape';
import { loadFonts } from '~/utils/video-editor/load-fonts';
import BrowserCompatibilityScreen from '~/components/startup/BrowserCompatibilityScreen.vue';
import {
  evaluateBrowserCompatibility,
  type BrowserCompatibilityReport,
} from '~/utils/browser-compatibility';
import { isTauriRuntime } from '~/utils/runtime';
import { isEmbedRuntime } from '~/utils/embed-runtime';
const uiStore = useUiStore();
const { t } = useI18n();
const { isMobileLayout } = useMobileLayout();

const colorMode = useColorMode();
const presetsStore = usePresetsStore();
const runtimeConfig = useRuntimeConfig();
const workspaceStore = useWorkspaceStore();
const browserCompatibilityReport = shallowRef<BrowserCompatibilityReport | null>(null);
if (typeof window !== 'undefined' && !isTauriRuntime()) {
  browserCompatibilityReport.value = evaluateBrowserCompatibility({
    requireSharedArrayBuffer: !isEmbedRuntime(),
  });
}
const isBrowserCompatibilityBlocked = computed(
  () =>
    !isTauriRuntime() &&
    !!browserCompatibilityReport.value &&
    !browserCompatibilityReport.value.isSupported,
);
useDismissMenusOnEscape();

function preventContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  const isEditable = target.closest(
    'input, textarea, [contenteditable="true"], .allow-native-context-menu',
  );
  if (isEditable) return;

  e.preventDefault();
}

// Load presets on startup. At mount time user settings are still defaults —
// they are loaded from disk later inside `workspaceStore.init()`, so re-run the
// load once initialization finishes to pick up custom presets and collapsed
// states. (`immediate` covers the case where init already completed.)
watch(
  () => workspaceStore.isInitializing,
  (isInitializing) => {
    if (!isInitializing) presetsStore.load();
  },
  { immediate: true },
);

onMounted(() => {
  loadFonts(); // Load Google fonts in the main thread too
  const shouldBlockContextMenu =
    runtimeConfig.public.blockContextMenu !== false &&
    String(runtimeConfig.public.blockContextMenu).toLowerCase() !== 'false';
  if (shouldBlockContextMenu) {
    window.addEventListener('contextmenu', preventContextMenu);
  }

  const shouldBlockTextSelection =
    runtimeConfig.public.blockTextSelection !== false &&
    String(runtimeConfig.public.blockTextSelection).toLowerCase() !== 'false';
  if (typeof document !== 'undefined' && shouldBlockTextSelection) {
    document.documentElement.classList.add('block-text-selection');
  }
});

onUnmounted(() => {
  window.removeEventListener('contextmenu', preventContextMenu);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('block-text-selection');
  }
});

if (!isEmbedRuntime()) useConfirmClose();

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
    <BrowserCompatibilityScreen
      v-if="isBrowserCompatibilityBlocked && browserCompatibilityReport"
      :report="browserCompatibilityReport"
    />
    <template v-else>
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
      <BackgroundTaskToasts />
      <RecoveryDialog />
      <CloseConfirmDialog />
      <!-- <RemoteFileExchangeModal /> -->
      <DesktopMediaReplaceModal v-if="!isMobileLayout" />
      <MobileMediaPickerDrawer
        v-if="isMobileLayout"
        :is-open="uiStore.isMediaReplaceModalOpen"
        :is-replace-mode="true"
        @close="uiStore.isMediaReplaceModalOpen = false"
      />
      <MobileForegroundTaskOverlay />
    </template>

    <!-- Foreground Audio Extraction Modal -->
    <UiModal
      v-model:open="uiStore.isExtractingAudio"
      :title="
        uiStore.extractingAudioError
          ? t('videoEditor.fileManager.extractAudio.failed')
          : t('videoEditor.fileManager.actions.extractAudio')
      "
      :close-button="!!uiStore.extractingAudioError"
      :prevent-close="!uiStore.extractingAudioError"
    >
      <div class="flex flex-col items-center justify-center p-6 gap-4 text-center">
        <UiProgressSpinner v-if="!uiStore.extractingAudioError" size="md" />
        <UIcon v-else name="i-heroicons-exclamation-triangle" class="w-12 h-12 text-error-500" />

        <div class="text-sm font-medium text-ui-text">
          <span v-if="!uiStore.extractingAudioError">
            {{ t('videoEditor.fileManager.extractAudio.extracting') }}
          </span>
          <span v-else class="text-error-500">
            {{ uiStore.extractingAudioError }}
          </span>
        </div>
      </div>

      <template v-if="uiStore.extractingAudioError" #footer>
        <div class="flex justify-end w-full">
          <UButton
            color="neutral"
            variant="solid"
            @click="void (uiStore.isExtractingAudio = false)"
          >
            {{ t('common.close') }}
          </UButton>
        </div>
      </template>
    </UiModal>
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
