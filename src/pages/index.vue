<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useLocalStorage } from '@vueuse/core';
import { storeToRefs } from 'pinia';

// Stores
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

// Composables
import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';

// Components
import LoadingScreen from '~/components/startup/LoadingScreen.vue';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';
import EditorHeader from '~/components/editor/EditorHeader.vue';
import TimelineExportModal from '~/components/TimelineExportModal.vue';
import EditorSettingsModal from '~/components/EditorSettingsModal.vue';
import ProjectSettingsModal from '~/components/ProjectSettingsModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();

const { currentTimelinePath } = storeToRefs(projectStore);

const isExportModalOpen = ref(false);
const isEditorSettingsOpen = ref(false);
const isProjectSettingsOpen = ref(false);
const isStartingUp = ref(true);

// Initialize Hotkeys
useEditorHotkeys();

// Splitpanes persistence
const mainSplitSizes = useLocalStorage<number[]>('gran-editor-main-split-v4', [40, 60]);
const topSplitSizes = useLocalStorage<number[]>('gran-editor-top-split-v4', [20, 60, 20]);

function onMainSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    mainSplitSizes.value = event.panes.map((p) => p.size);
  }
}

function onTopSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    topSplitSizes.value = event.panes.map((p) => p.size);
  }
}

// Watchers
watch(currentTimelinePath, async (newPath) => {
  if (newPath && projectStore.currentProjectName) {
    focusStore.setActiveTimelinePath(newPath);
    await timelineStore.loadTimeline();
    void timelineStore.loadTimelineMetadata();
  }
});

// Initialization
onMounted(async () => {
  try {
    await workspaceStore.init();

    if (
      workspaceStore.workspaceHandle &&
      workspaceStore.userSettings.openLastProjectOnStart &&
      workspaceStore.lastProjectName &&
      workspaceStore.projects.includes(workspaceStore.lastProjectName)
    ) {
      await projectStore.openProject(workspaceStore.lastProjectName);
      uiStore.restoreFileTreeStateOnce(workspaceStore.lastProjectName);
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
  <div class="flex flex-col flex-1 h-full min-h-0">
    <!-- Loading Screen -->
    <LoadingScreen v-if="isStartingUp" />

    <!-- Welcome / Select Folder Screen -->
    <WelcomeScreen v-else-if="!workspaceStore.workspaceHandle" />

    <!-- Projects List Screen -->
    <ProjectsScreen v-else-if="!projectStore.currentProjectName" />

    <!-- Editor Screen -->
    <template v-else>
      <EditorHeader
        @open-project-settings="isProjectSettingsOpen = true"
        @open-editor-settings="isEditorSettingsOpen = true"
        @open-export-modal="isExportModalOpen = true"
      />

      <ClientOnly>
        <Splitpanes
          class="flex-1 min-h-0 editor-splitpanes"
          horizontal
          @resized="onMainSplitResize"
        >
          <Pane :size="mainSplitSizes[0]" min-size="10">
            <Splitpanes class="editor-splitpanes" @resized="onTopSplitResize">
              <Pane :size="topSplitSizes[0]" min-size="5">
                <FileManager class="h-full" />
              </Pane>
              <Pane :size="topSplitSizes[1]" min-size="10">
                <Monitor class="h-full" />
              </Pane>
              <Pane :size="topSplitSizes[2]" min-size="5">
                <PropertiesPanel class="h-full" />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane :size="mainSplitSizes[1]" min-size="10">
            <Timeline class="h-full" />
          </Pane>
        </Splitpanes>
      </ClientOnly>

      <!-- Modals -->
      <TimelineExportModal v-model:open="isExportModalOpen" @exported="() => {}" />
      <EditorSettingsModal v-model:open="isEditorSettingsOpen" />
      <ProjectSettingsModal v-model:open="isProjectSettingsOpen" />

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
    </template>
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
