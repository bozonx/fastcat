<script setup lang="ts">
import { onMounted } from 'vue';
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
import { useConfirmClose } from '~/composables/useConfirmClose';

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

// isEditorSettingsOpen and isProjectSettingsOpen are now in uiStore
const isStartingUp = ref(true);

// Initialize Actions and Hotkeys
useEditorHotkeys();
useConfirmClose();

// Initialization
onMounted(async () => {
  try {
    await workspaceStore.init();

    if (
      route.path === '/' &&
      workspaceStore.workspaceHandle &&
      workspaceStore.userSettings.openLastProjectOnStart &&
      workspaceStore.lastProjectName &&
      workspaceStore.projects.includes(workspaceStore.lastProjectName)
    ) {
      await navigateTo(`/editor/${encodeURIComponent(workspaceStore.lastProjectName)}`);
    }
  } finally {
    isStartingUp.value = false;
  }
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

function isMobileEditorRoute() {
  return route.path.startsWith('/m/');
}

function flushMobileTimelineAutosave() {
  if (!isMobileEditorRoute() || !timelineStore.isTimelineDirty) return;
  void timelineStore.requestTimelineSave({ immediate: true });
}

useEventListener(window, 'blur', flushMobileTimelineAutosave);
useEventListener(document, 'visibilitychange', () => {
  if (document.hidden) {
    flushMobileTimelineAutosave();
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
        v-show="!isStartingUp && workspaceStore.workspaceHandle"
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
        <LoadingScreen />
      </template>
      <template v-else-if="!workspaceStore.workspaceHandle">
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
