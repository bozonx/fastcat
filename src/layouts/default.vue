<script setup lang="ts">
import { onMounted, watch } from 'vue';
import 'splitpanes/dist/splitpanes.css';
import { useEventListener } from '@vueuse/core';

// Stores
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';

// Composables
import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';
import { useGlobalDragAndDrop } from '~/composables/editor/useGlobalDragAndDrop';

// Components
import LoadingScreen from '~/components/startup/LoadingScreen.vue';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import EditorHeader from '~/components/editor/EditorHeader.vue';
import ProjectLockedModal from '~/components/editor/ProjectLockedModal.vue';
import EditorSettingsModal from '~/components/settings/EditorSettingsModal.vue';
import ProjectSettingsModal from '~/components/project-settings/ProjectSettingsModal.vue';
import FileConversionModal from '~/components/file-manager/FileConversionModal.vue';
import GlobalDropOverlay from '~/components/file-manager/GlobalDropOverlay.vue';
import FileManagerRemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import { useFileManager } from '~/composables/file-manager/useFileManager';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const route = useRoute();

const {
  onGlobalDragOver,
  onGlobalDragLeave,
  onGlobalDrop,
  handleAutoFileDrop,
  handleFolderFileDrop,
  isUploading,
  uploadProgress,
  uploadFileName,
  uploadPhase,
  cancelUpload,
} = useGlobalDragAndDrop();
const fileManager = useFileManager();

watch(
  () => projectStore.currentProjectName,
  (name) => {
    if (name) {
      void fileManager.loadProjectDirectory({ fullRefresh: true });
    }
  },
  { immediate: true },
);

// isEditorSettingsOpen and isProjectSettingsOpen are now in uiStore
const isStartingUp = ref(true);
const isAutoOpening = ref(false);
const autoOpenProjectName = ref<string | null>(null);

function cancelAutoOpen() {
  isAutoOpening.value = false;
  autoOpenProjectName.value = null;
  isStartingUp.value = false;
  void navigateTo('/');
  void projectStore.closeProject();
}

watch(
  () => projectStore.currentProjectName,
  (name) => {
    if (name && isAutoOpening.value) {
      isStartingUp.value = false;
      isAutoOpening.value = false;
      autoOpenProjectName.value = null;
    }
  }
);

watch(
  () => route.path,
  (newPath) => {
    if (newPath === '/' && isAutoOpening.value) {
      isAutoOpening.value = false;
      autoOpenProjectName.value = null;
      isStartingUp.value = false;
    }
  }
);

// Initialize Actions and Hotkeys
useEditorHotkeys();

// Initialization
onMounted(() => {
  workspaceStore
    .init()
    .then(() => {
      const shouldAutoOpen =
        route.path === '/' &&
        route.query.mode !== 'desktop' &&
        (workspaceStore.workspaceHandle || workspaceStore.workspaceProviderId === 'tauri') &&
        workspaceStore.userSettings.openLastProjectOnStart &&
        workspaceStore.lastProjectName &&
        (workspaceStore.workspaceProviderId === 'tauri' ||
          workspaceStore.projects.includes(workspaceStore.lastProjectName));

      if (shouldAutoOpen) {
        isAutoOpening.value = true;
        autoOpenProjectName.value = workspaceStore.lastProjectName;
        const target =
          workspaceStore.workspaceProviderId === 'tauri' && workspaceStore.lastProjectPath
            ? workspaceStore.lastProjectPath
            : workspaceStore.lastProjectName;
        void navigateTo(`/editor/${encodeURIComponent(target)}`);
      } else {
        isStartingUp.value = false;
      }
    })
    .catch(() => {
      isStartingUp.value = false;
    });
});

function onOverlayAutoSort(files: File[]) {
  uiStore.isGlobalDragging = false;
  handleAutoFileDrop(files);
}

function onOverlayFolderDrop(files: File[], targetDirPath: string) {
  uiStore.isGlobalDragging = false;
  handleFolderFileDrop(files, targetDirPath);
}

useHead({
  title: t('navigation.fastcat'),
});

// Autosave is periodic, but when the window loses focus or is hidden we flush
// the crash-recovery sidecar immediately so an unexpected exit can't lose more
// than the edits made since the last flush. Applies to all platforms.
function flushTimelineAutosaveOnHide() {
  if (!timelineStore.isTimelineDirty) return;
  void timelineStore.flushTimelineAutosave();
}

useEventListener(window, 'blur', flushTimelineAutosaveOnHide);
useEventListener(document, 'visibilitychange', () => {
  if (document.hidden) {
    flushTimelineAutosaveOnHide();
  }
});
</script>

<template>
  <div
    class="flex flex-col h-screen w-screen overflow-hidden bg-ui-bg text-ui-text"
    @dragover.prevent="onGlobalDragOver"
    @dragleave.prevent="onGlobalDragLeave"
    @drop.prevent="onGlobalDrop"
  >
    <div class="flex flex-col flex-1 h-full min-h-0 relative">
      <!-- Main Content (NuxtPage) -->
      <div
        v-show="
          !isStartingUp &&
          (workspaceStore.workspaceHandle || workspaceStore.workspaceProviderId === 'tauri')
        "
        class="flex flex-col flex-1 min-h-0 relative"
      >
        <EditorHeader
          v-if="projectStore.currentProjectName && route.path !== '/'"
          @open-project-settings="uiStore.isProjectSettingsOpen = true"
          @open-editor-settings="uiStore.isEditorSettingsOpen = true"
        />
        <div class="flex-1 min-h-0 overflow-y-auto">
          <slot />
        </div>
      </div>

      <!-- Startup Screens (Overlays) -->
      <template v-if="isStartingUp">
        <LoadingScreen
          :is-auto-opening="isAutoOpening"
          :project-name="autoOpenProjectName"
          @cancel="cancelAutoOpen"
        />
      </template>
      <template
        v-else-if="
          !workspaceStore.workspaceHandle && workspaceStore.workspaceProviderId !== 'tauri'
        "
      >
        <WelcomeScreen />
      </template>

      <!-- Modals -->
      <EditorSettingsModal v-model:open="uiStore.isEditorSettingsOpen" />
      <ProjectSettingsModal v-model:open="uiStore.isProjectSettingsOpen" />
      <ProjectLockedModal />
      <FileConversionModal />
      <FileManagerRemoteTransferProgressModal
        :open="isUploading"
        :title="t('videoEditor.fileManager.actions.importing')"
        :description="t('videoEditor.fileManager.actions.importing')"
        :progress="uploadProgress"
        :phase="uploadPhase"
        :file-name="uploadFileName"
        @cancel="cancelUpload"
      />

      <!-- Global Drop Overlay -->
      <GlobalDropOverlay
        v-if="uiStore.isGlobalDragging && projectStore.currentProjectName && route.path !== '/'"
        :root-entries="fileManager.rootEntries.value"
        @drop-to-auto="onOverlayAutoSort"
        @drop-to-folder="onOverlayFolderDrop"
      />
    </div>
  </div>
</template>
