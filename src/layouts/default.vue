<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import 'splitpanes/dist/splitpanes.css';
import { storeToRefs } from 'pinia';

// Stores
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

// Composables
import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useGlobalDragAndDrop } from '~/composables/editor/useGlobalDragAndDrop';

// Components
import LoadingScreen from '~/components/startup/LoadingScreen.vue';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';
import EditorHeader from '~/components/editor/EditorHeader.vue';
import ProjectLockedModal from '~/components/editor/ProjectLockedModal.vue';
import EditorSettingsModal from '~/components/EditorSettingsModal.vue';
import ProjectSettingsModal from '~/components/ProjectSettingsModal.vue';
import FileConversionModal from '~/components/file-manager/FileConversionModal.vue';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const route = useRoute();

const { onGlobalDragOver, onGlobalDragLeave, onGlobalDrop } = useGlobalDragAndDrop();

const isEditorSettingsOpen = ref(false);
const isProjectSettingsOpen = ref(false);
const isStartingUp = ref(true);

const fileConversion = useFileConversion();
const {
  isModalOpen: conversionModalOpen,
  videoFormat: conversionVideoFormat,
  videoCodec: conversionVideoCodec,
  videoBitrateMbps: conversionVideoBitrateMbps,
  excludeAudio: conversionExcludeAudio,
  audioCodec: conversionAudioCodec,
  audioBitrateKbps: conversionAudioBitrateKbps,
  bitrateMode: conversionBitrateMode,
  keyframeIntervalSec: conversionKeyframeIntervalSec,
  audioOnlyFormat: conversionAudioOnlyFormat,
  audioOnlyCodec: conversionAudioOnlyCodec,
  audioOnlyBitrateKbps: conversionAudioOnlyBitrateKbps,
  audioChannels: conversionAudioChannels,
  audioSampleRate: conversionAudioSampleRate,
  imageQuality: conversionImageQuality,
  imageWidth: conversionImageWidth,
  imageHeight: conversionImageHeight,
  isImageResolutionLinked: conversionIsImageResolutionLinked,
  imageAspectRatio: conversionImageAspectRatio,
  mediaType: conversionMediaType,
  targetEntry: conversionTargetEntry,
  originalAudioSampleRate: conversionOriginalAudioSampleRate,
  isConverting: conversionIsConverting,
  conversionProgress: conversionProgress,
  conversionError: conversionError,
  conversionPhase: conversionPhase,
} = fileConversion;

// Initialize Actions and Hotkeys
const { openProject } = useProjectActions();
useEditorHotkeys();

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
      await openProject(workspaceStore.lastProjectName);
    }
  } finally {
    isStartingUp.value = false;
  }
});

useHead({
  title: t('navigation.granVideoEditor'),
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
          @open-project-settings="isProjectSettingsOpen = true"
          @open-editor-settings="isEditorSettingsOpen = true"
        />
        <div class="flex-1 min-h-0 overflow-hidden">
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
      <EditorSettingsModal v-model:open="isEditorSettingsOpen" />
      <ProjectSettingsModal v-model:open="isProjectSettingsOpen" />
      <ProjectLockedModal />

      <FileConversionModal
        v-model:open="conversionModalOpen"
        v-model:video-format="conversionVideoFormat"
        v-model:video-codec="conversionVideoCodec"
        v-model:video-bitrate-mbps="conversionVideoBitrateMbps"
        v-model:exclude-audio="conversionExcludeAudio"
        v-model:audio-codec="conversionAudioCodec"
        v-model:audio-bitrate-kbps="conversionAudioBitrateKbps"
        v-model:bitrate-mode="conversionBitrateMode"
        v-model:keyframe-interval-sec="conversionKeyframeIntervalSec"
        v-model:audio-only-format="conversionAudioOnlyFormat"
        v-model:audio-only-codec="conversionAudioOnlyCodec"
        v-model:audio-only-bitrate-kbps="conversionAudioOnlyBitrateKbps"
        v-model:audio-channels="conversionAudioChannels"
        v-model:audio-sample-rate="conversionAudioSampleRate"
        v-model:image-quality="conversionImageQuality"
        v-model:image-width="conversionImageWidth"
        v-model:image-height="conversionImageHeight"
        v-model:is-image-resolution-linked="conversionIsImageResolutionLinked"
        v-model:image-aspect-ratio="conversionImageAspectRatio"
        :media-type="conversionMediaType"
        :file-name="conversionTargetEntry?.name ?? ''"
        :original-audio-sample-rate="conversionOriginalAudioSampleRate"
        :is-converting="conversionIsConverting"
        :conversion-progress="conversionProgress"
        :conversion-error="conversionError"
        :conversion-phase="conversionPhase"
        @convert="fileConversion.startConversion"
        @cancel="fileConversion.cancelConversion"
      />

      <!-- Drag Overlay Hint -->
      <div
        v-if="uiStore.isGlobalDragging && !uiStore.isFileManagerDragging"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs transition-opacity pointer-events-none"
      >
        <div
          class="flex flex-col items-center justify-center p-12 bg-ui-bg-elevated/90 border border-primary-500/50 rounded-3xl shadow-2xl animate-pulse-slow"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="w-20 h-20 text-primary-500 mb-6" />
          <h2 class="text-3xl font-bold text-white mb-2 text-center">
            {{ t('videoEditor.fileManager.actions.dropFilesHere', 'Drop files here') }}
          </h2>
          <div class="space-y-4 text-center max-w-md">
            <p class="text-lg text-ui-text-muted">
              {{
                t(
                  'videoEditor.fileManager.actions.dropFilesGlobalDescription',
                  'Release files to automatically save them to the project sources folder',
                )
              }}
            </p>
            <div
              class="flex items-center justify-center gap-2 py-2 px-4 bg-primary-500/10 rounded-xl border border-primary-400/20"
            >
              <UIcon name="i-heroicons-folder" class="w-5 h-5 text-primary-400" />
              <p class="text-sm font-medium text-primary-400">
                {{
                  t(
                    'videoEditor.fileManager.actions.dropToFolderHint',
                    'Drag to the File Manager on the left to upload to a specific folder',
                  )
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Custom theme for splitpanes matching Gran Video Editor dark mode */
.editor-splitpanes {
  background-color: transparent;
}
.editor-splitpanes .splitpanes__pane {
  background-color: transparent;
}
.editor-splitpanes > .splitpanes__splitter {
  background-color: var(--color-ui-border);
  position: relative;
  box-sizing: border-box;
}
.editor-splitpanes > .splitpanes__splitter:before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  transition: background-color 0.2s;
  background-color: transparent;
  z-index: 10;
}
.editor-splitpanes > .splitpanes__splitter:hover:before {
  background-color: var(--color-primary-500);
}
.editor-splitpanes.splitpanes--vertical > .splitpanes__splitter {
  width: 2px;
  cursor: col-resize;
}
.editor-splitpanes.splitpanes--vertical > .splitpanes__splitter:before {
  left: -3px;
  right: -3px;
  height: 100%;
}
.editor-splitpanes.splitpanes--horizontal > .splitpanes__splitter {
  height: 2px;
  cursor: row-resize;
}
.editor-splitpanes.splitpanes--horizontal > .splitpanes__splitter:before {
  top: -3px;
  bottom: -3px;
  width: 100%;
}
</style>
