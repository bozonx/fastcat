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
import Timeline from '~/components/Timeline.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';

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
  if (Array.isArray(event?.panes) && event.panes.length >= 2 && typeof event.panes[1]?.size === 'number') {
    const timelinePaneSize = event.panes[1].size;
    projectStore.timelineHeight = timelinePaneSize;
  }
}

// Drag and drop logic for dynamic panels
const draggingPanelIndex = ref<number | null>(null);
const dragOverPanelIndex = ref<number | null>(null);
const dropPosition = ref<'left' | 'right' | null>(null);

function onDragStart(event: DragEvent, index: number) {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    // Use an invisible image or just let default ghost image
  }
  draggingPanelIndex.value = index;
}

function onDragOver(event: DragEvent, index: number) {
  event.preventDefault();
  if (draggingPanelIndex.value === null || draggingPanelIndex.value === index) {
    dragOverPanelIndex.value = null;
    dropPosition.value = null;
    return;
  }
  
  dragOverPanelIndex.value = index;
  
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  
  if (x < rect.width / 2) {
    dropPosition.value = 'left';
  } else {
    dropPosition.value = 'right';
  }
}

function onDragLeave(event: DragEvent, index: number) {
  // Only clear if we actually leave the element, not when entering children
  const target = event.currentTarget as HTMLElement;
  const relatedTarget = event.relatedTarget as Node | null;
  if (!target.contains(relatedTarget)) {
    if (dragOverPanelIndex.value === index) {
      dragOverPanelIndex.value = null;
      dropPosition.value = null;
    }
  }
}

function onDrop(event: DragEvent, index: number) {
  event.preventDefault();
  if (draggingPanelIndex.value === null || dragOverPanelIndex.value === null) {
    resetDragState();
    return;
  }
  
  const fromIndex = draggingPanelIndex.value;
  let toIndex = dragOverPanelIndex.value;
  
  if (dropPosition.value === 'right') {
    toIndex += 1;
  }
  
  // Adjust index if moving from left to right to account for the removed element
  if (fromIndex < toIndex) {
    toIndex -= 1;
  }
  
  if (fromIndex !== toIndex) {
    projectStore.movePanel(fromIndex, toIndex);
  }
  
  resetDragState();
}

function onDragEnd() {
  resetDragState();
}

function resetDragState() {
  draggingPanelIndex.value = null;
  dragOverPanelIndex.value = null;
  dropPosition.value = null;
}
</script>

<template>
  <ClientOnly>
    <!-- Fullscreen View -->
    <div v-if="projectStore.currentView === 'fullscreen'" class="h-screen w-screen bg-ui-bg text-ui-text overflow-hidden">
      <MonitorContainer is-fullscreen />
    </div>

    <!-- Main Editor Layout (Files / Cut / Sound) -->
    <div v-else class="h-screen">
      <Splitpanes
        class="flex-1 h-full editor-splitpanes"
        horizontal
        @resized="onMainSplitResize"
      >
        <!-- Top Panel: varies by view -->
        <Pane :size="100 - projectStore.timelineHeight" min-size="10">
          <!-- Files View: FileManager + FileBrowser + Properties -->
          <Splitpanes v-if="projectStore.currentView === 'files'" class="editor-splitpanes" @resized="onFilesResize">
            <Pane :size="filesSizes[0]" min-size="10">
              <FileManager folders-only class="h-full" @select="filesPageStore.selectFolder" />
            </Pane>
            <Pane :size="filesSizes[1]" min-size="10">
              <FileBrowser class="h-full" />
            </Pane>
            <Pane :size="filesSizes[2]" min-size="10">
              <PropertiesPanel :entity="filesPageStore.selectedEntity" class="h-full" />
            </Pane>
          </Splitpanes>

          <!-- Cut View: Dynamic Panels -->
          <Splitpanes v-else-if="projectStore.currentView === 'cut'" class="editor-splitpanes" @resized="onTopSplitResize">
            <Pane 
              v-for="(panel, index) in projectStore.cutPanels" 
              :key="panel.id" 
              :size="topSplitSizes[index] ?? (100 / projectStore.cutPanels.length)" 
              min-size="5"
            >
              <div 
                class="h-full w-full relative transition-all duration-200"
                :class="{
                  'opacity-50': draggingPanelIndex === index,
                  'border-l-2 border-l-primary-500': dragOverPanelIndex === index && dropPosition === 'left',
                  'border-r-2 border-r-primary-500': dragOverPanelIndex === index && dropPosition === 'right'
                }"
                @dragenter.prevent
                @dragover.prevent="(e) => onDragOver(e, index)"
                @dragleave="(e) => onDragLeave(e, index)"
                @drop.prevent="(e) => onDrop(e, index)"
                @dragend="onDragEnd"
              >
                <!-- Drag Handle Overlay for non-Properties panels (which handle their own) -->
                <div v-if="panel.type !== 'properties'" 
                     class="absolute top-0 left-0 right-0 h-8 z-10 cursor-grab active:cursor-grabbing flex justify-between items-center px-2 bg-transparent hover:bg-ui-bg-elevated/50 transition-colors"
                     draggable="true"
                     @dragstart="(e) => onDragStart(e, index)"
                >
                  <span class="text-xs text-ui-text-muted font-medium opacity-0 hover:opacity-100 transition-opacity flex items-center gap-1">
                    <UIcon name="i-heroicons-arrows-right-left" class="w-3 h-3" />
                  </span>
                </div>

                <FileManager v-if="panel.type === 'fileManager'" class="h-full pt-2" />
                <MonitorContainer v-else-if="panel.type === 'monitor'" class="h-full pt-2" />
                <PropertiesPanel v-else-if="panel.type === 'properties'" class="h-full" @panelDragStart="(e) => onDragStart(e, index)" />
                <div v-else-if="panel.type === 'text'" class="h-full w-full bg-ui-bg-elevated p-4 overflow-auto border border-ui-border flex flex-col pt-8 relative">
                  <div class="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 border-b border-ui-border text-sm z-20 bg-ui-bg-elevated cursor-grab active:cursor-grabbing"
                       draggable="true"
                       @dragstart="(e) => onDragStart(e, index)">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-heroicons-bars-2" class="w-4 h-4 text-ui-text-muted" />
                      <h3 class="font-bold truncate max-w-50" :title="panel.title">{{ panel.title }}</h3>
                    </div>
                    <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-x-mark" @click="projectStore.removePanel(panel.id)" />
                  </div>
                  <pre class="text-xs whitespace-pre-wrap flex-1 mt-2">{{ panel.fileContent }}</pre>
                </div>
              </div>
            </Pane>
          </Splitpanes>

          <!-- Sound View: Audio Panels -->
          <Splitpanes v-else-if="projectStore.currentView === 'sound'" class="editor-splitpanes" @resized="onSoundResize">
            <Pane :size="soundSizes[0]" min-size="10">
              <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
                <h3 class="font-bold mb-2">Звук: Панель 1</h3>
              </div>
            </Pane>
            <Pane :size="soundSizes[1]" min-size="10">
              <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
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
