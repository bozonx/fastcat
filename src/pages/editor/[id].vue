<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import EditorCutView from '~/components/editor/EditorCutView.vue';
import EditorExportView from '~/components/editor/EditorExportView.vue';
import EditorFilesView from '~/components/editor/EditorFilesView.vue';
import EditorSoundView from '~/components/editor/EditorSoundView.vue';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEditorDynamicPanels } from '~/composables/editor/useEditorDynamicPanels';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { computed } from 'vue';
import { useEventListener, until } from '@vueuse/core';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import Timeline from '~/components/Timeline.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { currentProjectId } = storeToRefs(projectStore);
const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const focusStore = useFocusStore();

const activeEditorView = computed(() => {
  if (projectStore.currentView === 'fullscreen') {
    return projectStore.lastViewBeforeFullscreen ?? 'cut';
  }

  return projectStore.currentView;
});

const defaultCutPanelSizes = computed(() => {
  const len = projectStore.cutPanels?.length || 0;
  if (len === 0) return [];
  const size = 100 / len;
  return Array(len).fill(size);
});

const defaultSoundPanelSizes = computed(() => {
  const len = projectStore.soundPanels?.length || 0;
  if (len === 0) return [];
  const size = 100 / len;
  return Array(len).fill(size);
});

const { sizes: topSplitSizes, onResized: onTopSplitResize } = usePersistedSplitpanes(
  'editor-cut-top-dynamic',
  currentProjectId,
  defaultCutPanelSizes,
);

const { sizes: soundTopSplitSizes, onResized: onSoundTopSplitResize } = usePersistedSplitpanes(
  'editor-sound-dynamic',
  currentProjectId,
  defaultSoundPanelSizes,
);

const { sizes: filesSizes, onResized: onFilesResize } = usePersistedSplitpanes(
  'editor-files-top',
  currentProjectId,
  [20, 60, 20],
);

const { sizes: soundSizes, onResized: onSoundResize } = usePersistedSplitpanes(
  'editor-sound-top',
  currentProjectId,
  [75, 25],
);

const { sizes: exportSizes, onResized: onExportResize } = usePersistedSplitpanes(
  'editor-export-top',
  currentProjectId,
  [40, 60],
);

let fileManager: ReturnType<typeof useFileManager> | null = null;

function getFileManager() {
  fileManager ??= useFileManager();
  return fileManager;
}

function selectRootFolder() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: projectStore.currentProjectName || '',
    path: '',
  });
}

function selectWorkspaceCommonFolder() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: WORKSPACE_COMMON_DIR_NAME,
    path: WORKSPACE_COMMON_PATH_PREFIX,
  });
}

function selectFolderByPath(path: string) {
  if (!path) {
    selectRootFolder();
    return;
  }

  if (path === WORKSPACE_COMMON_PATH_PREFIX) {
    selectWorkspaceCommonFolder();
    return;
  }

  const { findEntryByPath } = getFileManager();
  const entry = findEntryByPath(path);
  if (entry && entry.kind === 'directory') {
    filesPageStore.selectFolder(entry);
  }
}

async function navigateToParentFolder() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) return;

  const currentPath = folder.path ?? '';
  if (!currentPath) return;

  const parentPath = getWorkspacePathParent(currentPath);
  selectFolderByPath(parentPath);
}

const {
  cutPanelsLayoutKey,
  soundPanelsLayoutKey,
  draggingPanelId,
  dragOverPanelId,
  dropPosition,
  getActiveDetachedPanel,
  getDynamicPanelFocusId,
  getVerticalSize,
  focusDynamicPanel,
  closePanelAndRestoreTab,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onVerticalSplitResize,
} = useEditorDynamicPanels({
  currentProjectId,
});

function isDynamicPanelFocused(panelId: string) {
  return focusStore.isPanelFocused(getDynamicPanelFocusId(panelId));
}

function getDynamicPanelVerticalSize(
  colId: string,
  rowIndex: number,
  totalRows: number,
  view?: 'cut' | 'sound',
) {
  return getVerticalSize({ colId, rowIndex, totalRows, view });
}

function onDynamicPanelDrop(event: DragEvent, targetPanelId: string, view: 'cut' | 'sound') {
  onDrop({ event, targetPanelId, view });
}

function onDynamicPanelVerticalResize(
  event: { panes?: Array<{ size: number }> } | Array<{ size: number }>,
  colId: string,
  view: 'cut' | 'sound',
) {
  onVerticalSplitResize({ event, colId, view });
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace') return;
  if (isEditableTarget(e.target)) return;

  if (projectStore.currentView === 'cut') {
    const activeDetachedPanel = getActiveDetachedPanel();
    if (!activeDetachedPanel) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    closePanelAndRestoreTab(activeDetachedPanel, { restoreFocus: true });
    return;
  }

  if (projectStore.currentView !== 'files') return;

  if (focusStore.effectiveFocus !== 'filesBrowser') return;

  e.preventDefault();
  e.stopImmediatePropagation();
  void navigateToParentFolder();
}

useEventListener(window, 'keydown', onGlobalKeyDown, { capture: true });

const { openProject } = useProjectActions();

onMounted(async () => {
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/');
    return;
  }

  if (workspaceStore.isInitializing) {
    await until(() => workspaceStore.isInitializing).toBe(false);
  }

  if (!workspaceStore.workspaceHandle) {
    router.push('/');
    return;
  }

  await openProject(decodeURIComponent(projectId));
});

function onMainSplitResize(event: { panes: { size: number }[] }) {
  if (!Array.isArray(event?.panes) || event.panes.length < 2) return;
  const lastPane = event.panes[event.panes.length - 1];
  if (typeof lastPane?.size === 'number') {
    projectStore.timelineHeight = lastPane.size;
  }
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <Splitpanes
        class="flex-1 min-h-0 overflow-hidden editor-splitpanes"
        horizontal
        @resized="onMainSplitResize"
      >
        <!-- Top Panel: varies by view -->
        <Pane :size="100 - projectStore.timelineHeight" min-size="10">
          <EditorFilesView
            v-if="activeEditorView === 'files'"
            :sizes="filesSizes"
            :selected-entity="selectionStore.selectedEntity"
            @resized="onFilesResize"
            @select-folder="filesPageStore.selectFolder"
            @clear-selection="selectionStore.clearSelection"
          />

          <EditorCutView
            v-else-if="activeEditorView === 'cut'"
            :columns="projectStore.cutPanels"
            :layout-key="cutPanelsLayoutKey"
            :top-sizes="topSplitSizes"
            :dragging-panel-id="draggingPanelId"
            :drag-over-panel-id="dragOverPanelId"
            :drop-position="dropPosition"
            :get-vertical-size="getDynamicPanelVerticalSize"
            :is-focused="isDynamicPanelFocused"
            :get-focus-id="getDynamicPanelFocusId"
            @top-resize="onTopSplitResize"
            @vertical-resize="onDynamicPanelVerticalResize"
            @drag-start="onDragStart"
            @drag-over="onDragOver"
            @drag-leave="onDragLeave"
            @drop="onDynamicPanelDrop"
            @drag-end="onDragEnd"
            @focus="focusDynamicPanel"
            @close="(panel, view) => closePanelAndRestoreTab(panel, { view })"
          />

          <EditorSoundView
            v-else-if="activeEditorView === 'sound'"
            :sizes="soundSizes"
            :columns="projectStore.soundPanels"
            :layout-key="soundPanelsLayoutKey"
            :top-sizes="soundTopSplitSizes"
            :dragging-panel-id="draggingPanelId"
            :drag-over-panel-id="dragOverPanelId"
            :drop-position="dropPosition"
            :get-vertical-size="getDynamicPanelVerticalSize"
            :is-focused="isDynamicPanelFocused"
            :get-focus-id="getDynamicPanelFocusId"
            @resized="onSoundResize"
            @top-resize="onSoundTopSplitResize"
            @vertical-resize="onDynamicPanelVerticalResize"
            @drag-start="onDragStart"
            @drag-over="onDragOver"
            @drag-leave="onDragLeave"
            @drop="onDynamicPanelDrop"
            @drag-end="onDragEnd"
            @focus="focusDynamicPanel"
            @close="(panel, view) => closePanelAndRestoreTab(panel, { view })"
          />

          <EditorExportView
            v-else-if="activeEditorView === 'export'"
            :sizes="exportSizes"
            @resized="onExportResize"
          />
        </Pane>

        <!-- Bottom Panel: Timeline (always visible, height varies) -->
        <Pane :size="projectStore.timelineHeight" min-size="5">
          <div class="h-full min-h-0 overflow-hidden">
            <Timeline class="h-full" />
          </div>
        </Pane>
      </Splitpanes>
    </div>
  </ClientOnly>
</template>
