<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { computed, ref } from 'vue';

import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import MediaPanelWrapper from '~/components/properties/file/MediaPanelWrapper.vue';
import Timeline from '~/components/Timeline.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';

// Vertical Splitpanes logic
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

const projectStore = useProjectStore();
const { currentProjectId } = storeToRefs(projectStore);
const filesPageStore = useFilesPageStore();

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
  [50, 50],
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
const draggingPanel = ref<{ col: number; row: number } | null>(null);
const dragOverPanel = ref<{ col: number; row: number } | null>(null);
const dropPosition = ref<'left' | 'right' | 'top' | 'bottom' | null>(null);

function onDragStart(event: DragEvent, col: number, row: number) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Use an invisible image or just let default ghost image
  }
  draggingPanel.value = { col, row };
}

function onDragOver(event: DragEvent, col: number, row: number) {
  event.preventDefault();
  if (!draggingPanel.value) {
    dragOverPanel.value = null;
    dropPosition.value = null;
    return;
  }
  if (draggingPanel.value.col === col && draggingPanel.value.row === row) {
    dragOverPanel.value = null;
    dropPosition.value = null;
    return;
  }

  dragOverPanel.value = { col, row };

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

function onDragLeave(event: DragEvent, col: number, row: number) {
  // Only clear if we actually leave the element, not when entering children
  const target = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target.contains(relatedTarget)) {
    if (dragOverPanel.value?.col === col && dragOverPanel.value?.row === row) {
      dragOverPanel.value = null;
      dropPosition.value = null;
    }
  }
}

function onDrop(event: DragEvent, col: number, row: number) {
  event.preventDefault();
  if (!draggingPanel.value || !dropPosition.value) {
    resetDragState();
    return;
  }

  projectStore.movePanel(
    draggingPanel.value.col,
    draggingPanel.value.row,
    col,
    row,
    dropPosition.value,
  );

  resetDragState();
}

function onDragEnd() {
  resetDragState();
}

function resetDragState() {
  draggingPanel.value = null;
  dragOverPanel.value = null;
  dropPosition.value = null;
}

const verticalSplitSizesKey = computed(
  () => `gran-cut-vertical-splits-${currentProjectId.value ?? 'no-project'}`,
);
const verticalSplitSizes = ref<Record<number, number[]>>(
  readLocalStorageJson<Record<number, number[]>>(verticalSplitSizesKey.value, {}),
);

watch(
  () => verticalSplitSizesKey.value,
  (key) => {
    verticalSplitSizes.value = readLocalStorageJson<Record<number, number[]>>(key, {});
  },
);

function onVerticalSplitResize(event: any, colIndex: number) {
  const panes = event?.panes ?? event;
  if (Array.isArray(panes)) {
    const newSizes = panes.map((p: any) => p.size);
    verticalSplitSizes.value[colIndex] = newSizes;
    writeLocalStorageJson(verticalSplitSizesKey.value, verticalSplitSizes.value);
  }
}

function getVerticalSize(colIndex: number, rowIndex: number): number | undefined {
  return verticalSplitSizes.value[colIndex]?.[rowIndex];
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
              <PropertiesPanel :entity="filesPageStore.selectedEntity" @clear-selection="filesPageStore.clearSelection" class="h-full" />
            </Pane>
          </Splitpanes>

          <!-- Cut View: Dynamic Panels (Columns and Rows) -->
          <Splitpanes
            v-else-if="projectStore.currentView === 'cut'"
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
                horizontal
                class="editor-splitpanes"
                @resized="(e: any) => onVerticalSplitResize(e, colIndex)"
              >
                <Pane
                  v-for="(panel, rowIndex) in col.panels"
                  :key="panel.id"
                  :size="getVerticalSize(colIndex, rowIndex) ?? 100 / col.panels.length"
                  min-size="5"
                >
                  <div
                    class="h-full w-full relative transition-all duration-200"
                    :class="{
                      'opacity-50':
                        draggingPanel?.col === colIndex && draggingPanel?.row === rowIndex,
                      'border-l-2 border-l-primary-500':
                        dragOverPanel?.col === colIndex &&
                        dragOverPanel?.row === rowIndex &&
                        dropPosition === 'left',
                      'border-r-2 border-r-primary-500':
                        dragOverPanel?.col === colIndex &&
                        dragOverPanel?.row === rowIndex &&
                        dropPosition === 'right',
                      'border-t-2 border-t-primary-500':
                        dragOverPanel?.col === colIndex &&
                        dragOverPanel?.row === rowIndex &&
                        dropPosition === 'top',
                      'border-b-2 border-b-primary-500':
                        dragOverPanel?.col === colIndex &&
                        dragOverPanel?.row === rowIndex &&
                        dropPosition === 'bottom',
                    }"
                    @dragenter.prevent
                    @dragover.prevent="(e) => onDragOver(e, colIndex, rowIndex)"
                    @dragleave="(e) => onDragLeave(e, colIndex, rowIndex)"
                    @drop.prevent="(e) => onDrop(e, colIndex, rowIndex)"
                    @dragend="onDragEnd"
                  >
                    <!-- Drag Handle Overlay for non-Properties panels (which handle their own) -->
                    <div
                      v-if="panel.type !== 'properties'"
                      class="absolute top-0 left-0 right-0 h-8 z-10 cursor-grab active:cursor-grabbing flex justify-between items-center px-2 bg-transparent hover:bg-ui-bg-elevated/50 transition-colors"
                      draggable="true"
                      @dragstart="(e) => onDragStart(e, colIndex, rowIndex)"
                    >
                      <span
                        class="text-xs text-ui-text-muted font-medium opacity-0 hover:opacity-100 transition-opacity flex items-center gap-1"
                      >
                        <UIcon name="i-heroicons-arrows-right-left" class="w-3 h-3" />
                      </span>
                    </div>

                    <FileManager v-if="panel.type === 'fileManager'" class="h-full pt-2" />
                    <MonitorContainer v-else-if="panel.type === 'monitor'" class="h-full pt-2" />
                    <PropertiesPanel
                      v-else-if="panel.type === 'properties'"
                      class="h-full"
                      @panel-drag-start="(e) => onDragStart(e, colIndex, rowIndex)"
                    />
                    <div
                      v-else-if="panel.type === 'media'"
                      class="h-full w-full bg-ui-bg-elevated flex flex-col relative pt-8 border border-ui-border"
                    >
                      <div
                        class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                        draggable="true"
                        @dragstart="(e) => onDragStart(e, colIndex, rowIndex)"
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
                          @click="projectStore.removePanel(panel.id)"
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
                        @dragstart="(e) => onDragStart(e, colIndex, rowIndex)"
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
                          @click="projectStore.removePanel(panel.id)"
                        />
                      </div>
                      <pre class="text-xs whitespace-pre-wrap flex-1 mt-2">{{
                        panel.fileContent
                      }}</pre>
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
              <div
                class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted"
              >
                <h3 class="font-bold mb-2">Звук: Панель 1</h3>
              </div>
            </Pane>
            <Pane :size="soundSizes[1]" min-size="10">
              <div
                class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted"
              >
                <h3 class="font-bold mb-2">Звук: Панель 2</h3>
              </div>
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
