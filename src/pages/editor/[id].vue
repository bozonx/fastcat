<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

import Project from '~/components/Project.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import MediaPanelWrapper from '~/components/properties/file/MediaPanelWrapper.vue';
import Timeline from '~/components/Timeline.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import TextEditor from '~/components/preview/TextEditor.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { DynamicPanel } from '~/stores/editorView.store';
import { hideStaticTab, showStaticTab } from '~/composables/project/useProjectTabs';
import { isOpenableProjectFileName } from '~/utils/media-types';

// Vertical Splitpanes logic
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const { currentProjectId } = storeToRefs(projectStore);
const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const focusStore = useFocusStore();

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

const { findEntryByPath, vfs } = useFileManager();

async function navigateToParentFolder() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) return;

  const currentPath = folder.path ?? '';
  if (!currentPath) return;

  const parentPath = getWorkspacePathParent(currentPath);
  if (!parentPath) {
    filesPageStore.selectFolder({
      kind: 'directory',
      name: projectStore.currentProjectName || '',
      path: '',
    });
    return;
  }

  if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
    filesPageStore.selectFolder({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
    return;
  }

  const parentEntry = findEntryByPath(parentPath);
  if (parentEntry && parentEntry.kind === 'directory') {
    filesPageStore.selectFolder(parentEntry);
  }
}

function getDynamicPanelFocusId(panelId: string) {
  return `dynamic:${panelId}` as const;
}

function focusDynamicPanel(panelId: string) {
  focusStore.setPanelFocus(getDynamicPanelFocusId(panelId));
}

function getActiveDetachedPanel() {
  const focusId = focusStore.effectiveFocus;
  if (!String(focusId).startsWith('dynamic:')) return null;
  const panelId = String(focusId).slice('dynamic:'.length);
  return (
    projectStore.cutPanels
      .flatMap((column) => column.panels)
      .find((panel) => panel.id === panelId) ?? null
  );
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

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
  const projectId = route.params.id as string;
  if (!projectId) {
    router.push('/');
    return;
  }

  const initProject = async () => {
    if (!workspaceStore.workspaceHandle) {
      router.push('/');
      return;
    }
    const { openProject } = useProjectActions();
    await openProject(decodeURIComponent(projectId));
  };

  if (workspaceStore.isInitializing) {
    const unwatch = watch(() => workspaceStore.isInitializing, async (isInit) => {
      if (!isInit) {
        unwatch();
        await initProject();
      }
    });
  } else {
    await initProject();
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
});

function onMainSplitResize(event: { panes: { size: number }[] }) {
  if (
    Array.isArray(event?.panes) &&
    event.panes.length >= 2 &&
    typeof event.panes[1]?.size === 'number'
  ) {
    const timelinePaneSize = event.panes[1].size;
    projectStore.timelineHeight = timelinePaneSize;
  }
}

// Drag and drop logic for dynamic panels
const draggingPanelId = ref<string | null>(null);
const dragOverPanelId = ref<string | null>(null);
const dropPosition = ref<'left' | 'right' | 'top' | 'bottom' | null>(null);

function onDragStart(event: DragEvent, panelId: string) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';

    // Find panel to attach file metadata for Project tab drop
    const panel = projectStore.cutPanels.flatMap((c) => c.panels).find((p) => p.id === panelId);
    if (panel && (panel.type === 'media' || panel.type === 'text') && panel.filePath) {
      const fileName = panel.title ?? panel.filePath.split('/').pop() ?? panel.filePath;
      event.dataTransfer.setData(
        'panel-drag',
        JSON.stringify({ panelId, filePath: panel.filePath, fileName }),
      );
    }
  }
  draggingPanelId.value = panelId;
}

function onDragOver(event: DragEvent, panelId: string, view: 'cut' | 'sound' = 'cut') {
  event.preventDefault();

  const isDraggingFile =
    event.dataTransfer?.types.includes('application/json') ||
    event.dataTransfer?.types.includes('application/gran-file-manager-move');
  const isDraggingPanel = !!draggingPanelId.value;
  const isDraggingTab =
    event.dataTransfer?.types.includes('static-tab-drag') ||
    event.dataTransfer?.types.includes('file-tab-drag');

  if (!isDraggingFile && !isDraggingPanel && !isDraggingTab) {
    return;
  }

  if (draggingPanelId.value === panelId) {
    dragOverPanelId.value = null;
    dropPosition.value = null;
    return;
  }

  dragOverPanelId.value = panelId;

  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const distLeft = x;
  const distRight = rect.width - x;
  const distTop = y;
  const distBottom = rect.height - y;

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist === distLeft) dropPosition.value = 'left';
  else if (minDist === distRight) dropPosition.value = 'right';
  else if (minDist === distTop) dropPosition.value = 'top';
  else dropPosition.value = 'bottom';
}

function onDragLeave(event: DragEvent, panelId: string) {
  const target = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target.contains(relatedTarget)) {
    if (dragOverPanelId.value === panelId) {
      dragOverPanelId.value = null;
      dropPosition.value = null;
    }
  }
}

function onDrop(event: DragEvent, targetPanelId: string, view: 'cut' | 'sound' = 'cut') {
  event.preventDefault();

  // static-tab-drag: detach Files/Effects/History tab into a separate panel
  const staticTabRaw = event.dataTransfer?.getData('static-tab-drag');
  if (staticTabRaw && dropPosition.value) {
    try {
      const payload = JSON.parse(staticTabRaw) as { tabId: string; label: string };
      const panelTypeMap: Record<string, DynamicPanel['type']> = {
        files: 'fileManager',
        history: 'history',
        effects: 'effects',
      };
      const panelType = panelTypeMap[payload.tabId] ?? 'fileManager';
      projectStore.insertPanelAt(
        { id: `static-${payload.tabId}-${Date.now()}`, type: panelType, title: payload.label },
        targetPanelId,
        dropPosition.value,
        view,
      );
      // Hide from Project tab bar
      hideStaticTab(payload.tabId);
    } catch {
      // ignore
    }
    resetDragState();
    return;
  }

  // file-tab-drag: detach file tab into a separate media panel
  const fileTabRaw = event.dataTransfer?.getData('file-tab-drag');
  if (fileTabRaw && dropPosition.value) {
    try {
      const payload = JSON.parse(fileTabRaw) as {
        tabId: string;
        filePath: string;
        fileName: string;
        mediaType: string;
      };
      const mType = (payload.mediaType || 'unknown') as 'video' | 'audio' | 'image' | 'unknown';
      projectStore.insertPanelAt(
        {
          id: `file-panel-${Date.now()}`,
          type: 'media',
          filePath: payload.filePath,
          mediaType: mType,
          title: payload.fileName,
        },
        targetPanelId,
        dropPosition.value,
        view,
      );
    } catch {
      // ignore
    }
    resetDragState();
    return;
  }

  // Try to parse file drag payload first
  const fileDragData =
    event.dataTransfer?.getData('application/json') ||
    event.dataTransfer?.getData('application/gran-file-manager-move');
  if (fileDragData) {
    try {
      const payload = JSON.parse(fileDragData);
      if (payload.kind === 'file' && dropPosition.value) {
        const panelPosition = dropPosition.value;
        if (!isOpenableProjectFileName(String(payload.name ?? ''))) {
          resetDragState();
          return;
        }

        const entry = findEntryByPath(payload.path);

        // Find extension to determine type
        const ext = payload.name?.split('.').pop()?.toLowerCase() ?? '';
        let mediaType: 'video' | 'audio' | 'image' | 'unknown' = 'unknown';

        if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) mediaType = 'audio';
        else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext))
          mediaType = 'image';

        if (['txt', 'md', 'json', 'yaml', 'yml'].includes(ext)) {
          void (async () => {
            let content = `File: ${payload.name}`;
            try {
              const blob = await vfs.readFile(payload.path);
              content = await blob.text();
            } catch {
              // ignore
            }
            projectStore.addTextPanel(
              payload.path,
              content,
              payload.name,
              targetPanelId,
              panelPosition,
              view,
            );
          })();
        } else {
          // Add as media panel
          projectStore.addMediaPanel(
            {
              kind: 'file',
              path: payload.path,
              name: payload.name,
              parentPath: payload.path.split('/').slice(0, -1).join('/') || undefined,
            },
            mediaType,
            payload.name,
            targetPanelId,
            panelPosition,
            view,
          );
        }
        resetDragState();
        return;
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // Handle panel reordering
  if (!draggingPanelId.value || !dropPosition.value) {
    resetDragState();
    return;
  }

  projectStore.movePanel(draggingPanelId.value, targetPanelId, dropPosition.value, view);

  resetDragState();
}

function onDragEnd() {
  resetDragState();
}

function resetDragState() {
  draggingPanelId.value = null;
  dragOverPanelId.value = null;
  dropPosition.value = null;
}

/** Map panel types back to static tab IDs */
const panelTypeToTabId: Record<string, string> = {
  history: 'history',
  effects: 'effects',
  fileManager: 'files',
};

/**
 * Close a panel and restore the corresponding Project tab if it's a detached static tab.
 */
function closePanelAndRestoreTab(
  panel: DynamicPanel,
  options?: { restoreFocus?: boolean; view?: 'cut' | 'sound' },
) {
  const tabId = panelTypeToTabId[panel.type];
  if (tabId) {
    showStaticTab(tabId);
  }
  projectStore.removePanel(panel.id, options?.view);

  if (options?.restoreFocus) {
    focusStore.restoreLastCutMainPanel();
  }
}

// Changes on every structural change — forces Splitpanes to remount and pick up new sizes
const cutPanelsLayoutKey = computed(() =>
  JSON.stringify(
    projectStore.cutPanels.map((c) => ({ id: c.id, rows: c.panels.map((p) => p.id) })),
  ),
);

const soundPanelsLayoutKey = computed(() =>
  JSON.stringify(
    projectStore.soundPanels.map((c) => ({ id: c.id, rows: c.panels.map((p) => p.id) })),
  ),
);

const verticalSplitSizesKey = computed(
  () => `gran-cut-vertical-splits-${currentProjectId.value ?? 'no-project'}`,
);
const verticalSplitSizes = ref<Record<string, number[]>>(
  readLocalStorageJson<Record<string, number[]>>(verticalSplitSizesKey.value, {}),
);

watch(
  () => verticalSplitSizesKey.value,
  (key) => {
    verticalSplitSizes.value = readLocalStorageJson<Record<string, number[]>>(key, {});
  },
);

const soundVerticalSplitSizesKey = computed(
  () => `gran-sound-vertical-splits-${currentProjectId.value ?? 'no-project'}`,
);
const soundVerticalSplitSizes = ref<Record<string, number[]>>(
  readLocalStorageJson<Record<string, number[]>>(soundVerticalSplitSizesKey.value, {}),
);

watch(
  () => soundVerticalSplitSizesKey.value,
  (key) => {
    soundVerticalSplitSizes.value = readLocalStorageJson<Record<string, number[]>>(key, {});
  },
);

function onVerticalSplitResize(event: any, colId: string, view: 'cut' | 'sound' = 'cut') {
  const panes = event?.panes ?? event;
  if (Array.isArray(panes)) {
    const newSizes = panes.map((p: any) => p.size);
    if (view === 'cut') {
      verticalSplitSizes.value[colId] = newSizes;
      writeLocalStorageJson(verticalSplitSizesKey.value, verticalSplitSizes.value);
    } else {
      soundVerticalSplitSizes.value[colId] = newSizes;
      writeLocalStorageJson(soundVerticalSplitSizesKey.value, soundVerticalSplitSizes.value);
    }
  }
}

function getVerticalSize(
  colId: string,
  rowIndex: number,
  totalRows: number,
  view: 'cut' | 'sound' = 'cut',
): number | undefined {
  const saved =
    view === 'cut' ? verticalSplitSizes.value[colId] : soundVerticalSplitSizes.value[colId];
  if (!saved || saved.length !== totalRows) return undefined;
  return saved[rowIndex];
}
</script>

<template>
  <ClientOnly>
    <!-- Fullscreen View -->
    <div
      v-if="projectStore.currentView === 'fullscreen'"
      class="h-screen w-screen bg-ui-bg text-ui-text overflow-hidden"
    >
      <MonitorContainer is-fullscreen />
    </div>

    <!-- Main Editor Layout (Files / Cut / Sound) -->
    <div v-else class="flex flex-col h-full min-h-0 overflow-hidden">
      <Splitpanes
        class="flex-1 min-h-0 overflow-hidden editor-splitpanes"
        horizontal
        @resized="onMainSplitResize"
      >
        <!-- Top Panel: varies by view -->
        <Pane :size="100 - projectStore.timelineHeight" min-size="10">
          <!-- Files View: FileManager + FileBrowser + Properties -->
          <Splitpanes
            v-if="projectStore.currentView === 'files'"
            class="editor-splitpanes"
            @resized="onFilesResize"
          >
            <Pane :size="filesSizes[0]" min-size="10">
              <FileManagerPanel
                folders-only
                disable-sort
                is-files-page
                class="h-full"
                @select="filesPageStore.selectFolder"
              />
            </Pane>
            <Pane :size="filesSizes[1]" min-size="10">
              <FileBrowser class="h-full" />
            </Pane>
            <Pane :size="filesSizes[2]" min-size="10">
              <PropertiesPanel
                :entity="selectionStore.selectedEntity"
                class="h-full"
                @clear-selection="selectionStore.clearSelection"
              />
            </Pane>
          </Splitpanes>

          <!-- Cut View: Dynamic Panels (Columns and Rows) -->
          <Splitpanes
            v-else-if="projectStore.currentView === 'cut'"
            :key="cutPanelsLayoutKey"
            class="editor-splitpanes"
            @resized="onTopSplitResize"
          >
            <Pane
              v-for="(col, colIndex) in projectStore.cutPanels"
              :key="col.id"
              :size="topSplitSizes[colIndex] ?? 100 / projectStore.cutPanels.length"
              min-size="5"
            >
              <Splitpanes
                :key="`${col.id}-${col.panels.map((panel) => panel.id).join('|')}`"
                horizontal
                class="editor-splitpanes"
                @resized="(e: any) => onVerticalSplitResize(e, col.id)"
              >
                <Pane
                  v-for="(panel, rowIndex) in col.panels"
                  :key="panel.id"
                  :size="
                    getVerticalSize(col.id, rowIndex, col.panels.length) ?? 100 / col.panels.length
                  "
                  min-size="5"
                >
                  <div
                    class="h-full w-full relative transition-all duration-200"
                    :class="{
                      'opacity-50': draggingPanelId === panel.id,
                      'border-l-2 border-l-primary-500':
                        dragOverPanelId === panel.id && dropPosition === 'left',
                      'border-r-2 border-r-primary-500':
                        dragOverPanelId === panel.id && dropPosition === 'right',
                      'border-t-2 border-t-primary-500':
                        dragOverPanelId === panel.id && dropPosition === 'top',
                      'border-b-2 border-b-primary-500':
                        dragOverPanelId === panel.id && dropPosition === 'bottom',
                      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
                        focusStore.isPanelFocused(getDynamicPanelFocusId(panel.id)),
                    }"
                    @pointerdown.capture="focusDynamicPanel(panel.id)"
                    @dragenter.prevent
                    @dragover.prevent="(e) => onDragOver(e, panel.id)"
                    @dragleave="(e) => onDragLeave(e, panel.id)"
                    @drop.prevent="(e) => onDrop(e, panel.id)"
                    @dragend="onDragEnd"
                  >
                    <div
                      v-if="focusStore.isPanelFocused(getDynamicPanelFocusId(panel.id))"
                      class="pointer-events-none absolute inset-0 z-30 ring-2 ring-primary-500/60 ring-inset"
                    />
                    <Project v-if="panel.type === 'fileManager'" class="h-full pt-2" />
                    <MonitorContainer
                      v-else-if="panel.type === 'monitor'"
                      class="h-full"
                      @panel-drag-start="(e) => onDragStart(e, panel.id)"
                    />
                    <PropertiesPanel
                      v-else-if="panel.type === 'properties'"
                      class="h-full"
                      @panel-drag-start="(e) => onDragStart(e, panel.id)"
                    />
                    <div
                      v-else-if="panel.type === 'media'"
                      class="h-full w-full bg-ui-bg-elevated flex flex-col relative pt-8 border border-ui-border"
                    >
                      <div
                        class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, panel.id)"
                        @dblclick="closePanelAndRestoreTab(panel, { view: 'cut' })"
                      >
                        <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <UIcon
                            v-if="panel.mediaType === 'image'"
                            name="i-heroicons-photo"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <UIcon
                            v-else-if="panel.mediaType === 'video'"
                            name="i-heroicons-film"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <UIcon
                            v-else-if="panel.mediaType === 'audio'"
                            name="i-heroicons-musical-note"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <h3 class="font-bold truncate min-w-0" :title="panel.title">
                            {{ panel.title }}
                          </h3>
                        </div>
                        <UButton
                          class="shrink-0"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel, { view: 'cut' })"
                        />
                      </div>
                      <div
                        class="flex-1 overflow-hidden min-h-0 relative"
                        @pointerdown.capture="focusDynamicPanel(panel.id)"
                      >
                        <MediaPanelWrapper
                          :file-path="panel.filePath || ''"
                          :media-type="panel.mediaType || 'unknown'"
                          :focus-panel-id="getDynamicPanelFocusId(panel.id)"
                        />
                      </div>
                    </div>
                    <div
                      v-else-if="panel.type === 'text'"
                      class="h-full w-full bg-ui-bg-elevated flex flex-col pt-8 relative border border-ui-border"
                    >
                      <div
                        class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, panel.id)"
                        @dblclick="closePanelAndRestoreTab(panel, { view: 'cut' })"
                      >
                        <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <UIcon
                            name="i-heroicons-bars-2"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <h3 class="font-bold truncate min-w-0" :title="panel.title">
                            {{ panel.title }}
                          </h3>
                        </div>
                        <UButton
                          class="shrink-0"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel, { view: 'cut' })"
                        />
                      </div>
                      <div
                        class="flex-1 overflow-hidden min-h-0 relative"
                        @pointerdown.capture="focusDynamicPanel(panel.id)"
                      >
                        <TextEditor
                          class="absolute inset-0 h-full w-full border-none"
                          :file-path="panel.filePath || ''"
                          :file-name="panel.title || ''"
                          :initial-content="panel.fileContent || ''"
                          :focus-panel-id="getDynamicPanelFocusId(panel.id)"
                        />
                      </div>
                    </div>

                    <!-- History panel (detached from Project tabs) -->
                    <div
                      v-else-if="panel.type === 'history'"
                      class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
                    >
                      <div
                        class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated cursor-grab active:cursor-grabbing shrink-0"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, panel.id)"
                        @dblclick="closePanelAndRestoreTab(panel, { view: 'cut' })"
                      >
                        <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <UIcon
                            name="i-heroicons-clock"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <h3 class="font-bold truncate min-w-0" :title="panel.title || 'History'">
                            {{ panel.title || 'History' }}
                          </h3>
                        </div>
                        <UButton
                          class="shrink-0"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel, { view: 'cut' })"
                        />
                      </div>
                      <div class="flex-1 overflow-hidden min-h-0">
                        <ProjectHistory class="h-full" />
                      </div>
                    </div>

                    <!-- Effects panel (detached from Project tabs) -->
                    <div
                      v-else-if="panel.type === 'effects'"
                      class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
                    >
                      <div
                        class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated cursor-grab active:cursor-grabbing shrink-0"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, panel.id)"
                        @dblclick="closePanelAndRestoreTab(panel, { view: 'cut' })"
                      >
                        <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <UIcon
                            name="i-heroicons-sparkles"
                            class="w-4 h-4 text-ui-text-muted shrink-0"
                          />
                          <h3 class="font-bold truncate min-w-0" :title="panel.title || 'Effects'">
                            {{ panel.title || 'Effects' }}
                          </h3>
                        </div>
                        <UButton
                          class="shrink-0"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel, { view: 'cut' })"
                        />
                      </div>
                      <div class="flex-1 overflow-hidden min-h-0">
                        <ProjectEffects class="h-full" />
                      </div>
                    </div>
                  </div>
                </Pane>
              </Splitpanes>
            </Pane>
          </Splitpanes>

          <!-- Sound View: Audio Panels -->
          <Splitpanes
            v-else-if="projectStore.currentView === 'sound'"
            class="editor-splitpanes"
            @resized="onSoundResize"
          >
            <Pane :size="soundSizes[0]" min-size="10">
              <AudioMixer />
            </Pane>
            <Pane :size="soundSizes[1]" min-size="10">
              <Splitpanes
                :key="soundPanelsLayoutKey"
                class="editor-splitpanes"
                @resized="onSoundTopSplitResize"
              >
                <Pane
                  v-for="(col, colIndex) in projectStore.soundPanels"
                  :key="col.id"
                  :size="soundTopSplitSizes[colIndex] ?? 100 / projectStore.soundPanels.length"
                  min-size="5"
                >
                  <Splitpanes
                    :key="`${col.id}-${col.panels.map((panel) => panel.id).join('|')}`"
                    horizontal
                    class="editor-splitpanes"
                    @resized="(e: any) => onVerticalSplitResize(e, col.id, 'sound')"
                  >
                    <Pane
                      v-for="(panel, rowIndex) in col.panels"
                      :key="panel.id"
                      :size="
                        getVerticalSize(col.id, rowIndex, col.panels.length, 'sound') ??
                        100 / col.panels.length
                      "
                      min-size="5"
                    >
                      <div
                        class="h-full w-full relative transition-all duration-200"
                        :class="{
                          'opacity-50': draggingPanelId === panel.id,
                          'border-l-2 border-l-primary-500':
                            dragOverPanelId === panel.id && dropPosition === 'left',
                          'border-r-2 border-r-primary-500':
                            dragOverPanelId === panel.id && dropPosition === 'right',
                          'border-t-2 border-t-primary-500':
                            dragOverPanelId === panel.id && dropPosition === 'top',
                          'border-b-2 border-b-primary-500':
                            dragOverPanelId === panel.id && dropPosition === 'bottom',
                          'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
                            focusStore.isPanelFocused(getDynamicPanelFocusId(panel.id)),
                        }"
                        @pointerdown.capture="focusDynamicPanel(panel.id)"
                        @dragenter.prevent
                        @dragover.prevent="(e) => onDragOver(e, panel.id, 'sound')"
                        @dragleave="(e) => onDragLeave(e, panel.id)"
                        @drop.prevent="(e) => onDrop(e, panel.id, 'sound')"
                        @dragend="onDragEnd"
                      >
                        <div
                          v-if="focusStore.isPanelFocused(getDynamicPanelFocusId(panel.id))"
                          class="pointer-events-none absolute inset-0 z-30 ring-2 ring-primary-500/60 ring-inset"
                        />
                        <Project v-if="panel.type === 'fileManager'" class="h-full pt-2" />
                        <MonitorContainer
                          v-else-if="panel.type === 'monitor'"
                          class="h-full"
                          @panel-drag-start="(e) => onDragStart(e, panel.id)"
                        />
                        <PropertiesPanel
                          v-else-if="panel.type === 'properties'"
                          class="h-full"
                          @panel-drag-start="(e) => onDragStart(e, panel.id)"
                        />
                        <div
                          v-else-if="panel.type === 'media'"
                          class="h-full w-full bg-ui-bg-elevated flex flex-col relative pt-8 border border-ui-border"
                        >
                          <div
                            class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                            draggable="true"
                            @dragstart="(e) => onDragStart(e, panel.id)"
                            @dblclick="closePanelAndRestoreTab(panel, { view: 'sound' })"
                          >
                            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                              <UIcon
                                v-if="panel.mediaType === 'image'"
                                name="i-heroicons-photo"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <UIcon
                                v-else-if="panel.mediaType === 'video'"
                                name="i-heroicons-film"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <UIcon
                                v-else-if="panel.mediaType === 'audio'"
                                name="i-heroicons-musical-note"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <h3 class="font-bold truncate min-w-0" :title="panel.title">
                                {{ panel.title }}
                              </h3>
                            </div>
                            <UButton
                              class="shrink-0"
                              size="xs"
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-x-mark"
                              @click="closePanelAndRestoreTab(panel, { view: 'sound' })"
                            />
                          </div>
                          <div
                            class="flex-1 overflow-hidden min-h-0 relative"
                            @pointerdown.capture="focusDynamicPanel(panel.id)"
                          >
                            <MediaPanelWrapper
                              :file-path="panel.filePath || ''"
                              :media-type="panel.mediaType || 'unknown'"
                              :focus-panel-id="getDynamicPanelFocusId(panel.id)"
                            />
                          </div>
                        </div>
                        <div
                          v-else-if="panel.type === 'text'"
                          class="h-full w-full bg-ui-bg-elevated flex flex-col pt-8 relative border border-ui-border"
                        >
                          <div
                            class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                            draggable="true"
                            @dragstart="(e) => onDragStart(e, panel.id)"
                            @dblclick="closePanelAndRestoreTab(panel, { view: 'sound' })"
                          >
                            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                              <UIcon
                                name="i-heroicons-bars-2"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <h3 class="font-bold truncate min-w-0" :title="panel.title">
                                {{ panel.title }}
                              </h3>
                            </div>
                            <UButton
                              class="shrink-0"
                              size="xs"
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-x-mark"
                              @click="closePanelAndRestoreTab(panel, { view: 'sound' })"
                            />
                          </div>
                          <div
                            class="flex-1 overflow-hidden min-h-0 relative"
                            @pointerdown.capture="focusDynamicPanel(panel.id)"
                          >
                            <TextEditor
                              class="absolute inset-0 h-full w-full border-none"
                              :file-path="panel.filePath || ''"
                              :file-name="panel.title || ''"
                              :initial-content="panel.fileContent || ''"
                              :focus-panel-id="getDynamicPanelFocusId(panel.id)"
                            />
                          </div>
                        </div>

                        <!-- History panel (detached from Project tabs) -->
                        <div
                          v-else-if="panel.type === 'history'"
                          class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
                        >
                          <div
                            class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated cursor-grab active:cursor-grabbing shrink-0"
                            draggable="true"
                            @dragstart="(e) => onDragStart(e, panel.id)"
                            @dblclick="closePanelAndRestoreTab(panel, { view: 'sound' })"
                          >
                            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                              <UIcon
                                name="i-heroicons-clock"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <h3
                                class="font-bold truncate min-w-0"
                                :title="panel.title || 'History'"
                              >
                                {{ panel.title || 'History' }}
                              </h3>
                            </div>
                            <UButton
                              class="shrink-0"
                              size="xs"
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-x-mark"
                              @click="closePanelAndRestoreTab(panel, { view: 'sound' })"
                            />
                          </div>
                          <div class="flex-1 overflow-hidden min-h-0">
                            <ProjectHistory class="h-full" />
                          </div>
                        </div>

                        <!-- Effects panel (detached from Project tabs) -->
                        <div
                          v-else-if="panel.type === 'effects'"
                          class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
                        >
                          <div
                            class="flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm bg-ui-bg-elevated cursor-grab active:cursor-grabbing shrink-0"
                            draggable="true"
                            @dragstart="(e) => onDragStart(e, panel.id)"
                            @dblclick="closePanelAndRestoreTab(panel, { view: 'sound' })"
                          >
                            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                              <UIcon
                                name="i-heroicons-sparkles"
                                class="w-4 h-4 text-ui-text-muted shrink-0"
                              />
                              <h3
                                class="font-bold truncate min-w-0"
                                :title="panel.title || 'Effects'"
                              >
                                {{ panel.title || 'Effects' }}
                              </h3>
                            </div>
                            <UButton
                              class="shrink-0"
                              size="xs"
                              variant="ghost"
                              color="neutral"
                              icon="i-heroicons-x-mark"
                              @click="closePanelAndRestoreTab(panel, { view: 'sound' })"
                            />
                          </div>
                          <div class="flex-1 overflow-hidden min-h-0">
                            <ProjectEffects class="h-full" />
                          </div>
                        </div>
                      </div>
                    </Pane>
                  </Splitpanes>
                </Pane>
              </Splitpanes>
            </Pane>
          </Splitpanes>

          <!-- Export View: Export Form + Monitor -->
          <Splitpanes
            v-else-if="projectStore.currentView === 'export'"
            class="editor-splitpanes"
            @resized="onExportResize"
          >
            <Pane :size="exportSizes[0]" min-size="20">
              <ExportForm class="h-full" />
            </Pane>
            <Pane :size="exportSizes[1]" min-size="20">
              <MonitorContainer class="h-full" />
            </Pane>
          </Splitpanes>
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
