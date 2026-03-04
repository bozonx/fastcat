<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { computed, ref, watch } from 'vue';

import Project from '~/components/Project.vue';
import ProjectFiles from '~/components/project/ProjectFiles.vue';
import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import MediaPanelWrapper from '~/components/properties/file/MediaPanelWrapper.vue';
import Timeline from '~/components/Timeline.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ExportForm from '~/components/export/ExportForm.vue';
import { useSelectionStore } from '~/stores/selection.store';
import type { DynamicPanel } from '~/stores/editorView.store';
import { hideStaticTab, showStaticTab } from '~/composables/project/useProjectTabs';

// Vertical Splitpanes logic
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

const projectStore = useProjectStore();
const { currentProjectId } = storeToRefs(projectStore);
const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();

const defaultCutPanelSizes = computed(() => {
  const len = projectStore.cutPanels?.length || 0;
  if (len === 0) return [];
  const size = 100 / len;
  return Array(len).fill(size);
});

const { sizes: topSplitSizes, onResized: onTopSplitResize } = usePersistedSplitpanes(
  'editor-cut-top-dynamic',
  currentProjectId,
  defaultCutPanelSizes,
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

function onDragOver(event: DragEvent, panelId: string) {
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

function onDrop(event: DragEvent, targetPanelId: string) {
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
        // Find extension to determine type
        const ext = payload.name?.split('.').pop()?.toLowerCase() ?? '';
        let mediaType: 'video' | 'audio' | 'image' | 'unknown' = 'unknown';

        if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) mediaType = 'audio';
        else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext))
          mediaType = 'image';

        if (['txt', 'md', 'json', 'yaml', 'yml'].includes(ext)) {
          projectStore.addTextPanel(
            payload.path,
            `File: ${payload.name}`,
            payload.name,
            targetPanelId,
            dropPosition.value,
          );
        } else {
          // Add as media panel
          projectStore.addMediaPanel(
            {
              kind: 'file',
              path: payload.path,
              name: payload.name,
              handle: payload.handle as any,
            },
            mediaType,
            payload.name,
            targetPanelId,
            dropPosition.value,
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

  projectStore.movePanel(draggingPanelId.value, targetPanelId, dropPosition.value);

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
function closePanelAndRestoreTab(panel: DynamicPanel) {
  const tabId = panelTypeToTabId[panel.type];
  if (tabId) {
    showStaticTab(tabId);
  }
  projectStore.removePanel(panel.id);
}

// Changes on every structural change — forces Splitpanes to remount and pick up new sizes
const cutPanelsLayoutKey = ref(0);
watch(
  () =>
    JSON.stringify(
      projectStore.cutPanels.map((c) => ({ id: c.id, rows: c.panels.map((p) => p.id) })),
    ),
  () => {
    cutPanelsLayoutKey.value++;
  },
  { flush: 'post' },
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

function onVerticalSplitResize(event: any, colId: string) {
  const panes = event?.panes ?? event;
  if (Array.isArray(panes)) {
    const newSizes = panes.map((p: any) => p.size);
    verticalSplitSizes.value[colId] = newSizes;
    writeLocalStorageJson(verticalSplitSizesKey.value, verticalSplitSizes.value);
  }
}

function getVerticalSize(colId: string, rowIndex: number, totalRows: number): number | undefined {
  const saved = verticalSplitSizes.value[colId];
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
    <div v-else class="h-screen">
      <Splitpanes class="flex-1 h-full editor-splitpanes" horizontal @resized="onMainSplitResize">
        <!-- Top Panel: varies by view -->
        <Pane :size="100 - projectStore.timelineHeight" min-size="10">
          <!-- Files View: FileManager + FileBrowser + Properties -->
          <Splitpanes
            v-if="projectStore.currentView === 'files'"
            class="editor-splitpanes"
            @resized="onFilesResize"
          >
            <Pane :size="filesSizes[0]" min-size="10">
              <FileManager
                folders-only
                disable-sort
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
                :key="col.id + '-' + col.panels.length"
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
                    }"
                    @dragenter.prevent
                    @dragover.prevent="(e) => onDragOver(e, panel.id)"
                    @dragleave="(e) => onDragLeave(e, panel.id)"
                    @drop.prevent="(e) => onDrop(e, panel.id)"
                    @dragend="onDragEnd"
                  >
                    <Project
                      v-if="panel.type === 'fileManager'"
                      class="h-full pt-2"
                    />
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
                      >
                        <div class="flex items-center gap-2">
                          <UIcon
                            v-if="panel.mediaType === 'image'"
                            name="i-heroicons-photo"
                            class="w-4 h-4 text-ui-text-muted"
                          />
                          <UIcon
                            v-else-if="panel.mediaType === 'video'"
                            name="i-heroicons-film"
                            class="w-4 h-4 text-ui-text-muted"
                          />
                          <UIcon
                            v-else-if="panel.mediaType === 'audio'"
                            name="i-heroicons-musical-note"
                            class="w-4 h-4 text-ui-text-muted"
                          />
                          <h3 class="font-bold truncate max-w-50" :title="panel.title">
                            {{ panel.title }}
                          </h3>
                        </div>
                        <UButton
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel)"
                        />
                      </div>
                      <div class="flex-1 overflow-hidden min-h-0 relative">
                        <MediaPanelWrapper
                          :file-path="panel.filePath || ''"
                          :media-type="panel.mediaType || 'unknown'"
                        />
                      </div>
                    </div>
                    <div
                      v-else-if="panel.type === 'text'"
                      class="h-full w-full bg-ui-bg-elevated p-4 overflow-auto border border-ui-border flex flex-col pt-8 relative"
                    >
                      <div
                        class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, panel.id)"
                      >
                        <div class="flex items-center gap-2">
                          <UIcon name="i-heroicons-bars-2" class="w-4 h-4 text-ui-text-muted" />
                          <h3 class="font-bold truncate max-w-50" :title="panel.title">
                            {{ panel.title }}
                          </h3>
                        </div>
                        <UButton
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel)"
                        />
                      </div>
                      <pre class="text-xs whitespace-pre-wrap flex-1 mt-2">{{
                        panel.fileContent
                      }}</pre>
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
                      >
                        <div class="flex items-center gap-2">
                          <UIcon name="i-heroicons-clock" class="w-4 h-4 text-ui-text-muted" />
                          <h3 class="font-bold truncate max-w-50">
                            {{ panel.title || 'History' }}
                          </h3>
                        </div>
                        <UButton
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel)"
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
                      >
                        <div class="flex items-center gap-2">
                          <UIcon name="i-heroicons-sparkles" class="w-4 h-4 text-ui-text-muted" />
                          <h3 class="font-bold truncate max-w-50">
                            {{ panel.title || 'Effects' }}
                          </h3>
                        </div>
                        <UButton
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          icon="i-heroicons-x-mark"
                          @click="closePanelAndRestoreTab(panel)"
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
              <MonitorContainer class="h-full" />
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
          <Timeline class="h-full" />
        </Pane>
      </Splitpanes>
    </div>
  </ClientOnly>
</template>
