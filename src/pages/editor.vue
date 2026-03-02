<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';
import { computed } from 'vue';

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
            <Pane v-for="(panel, index) in projectStore.cutPanels" :key="panel.id" :size="topSplitSizes[index] ?? (100 / projectStore.cutPanels.length)" min-size="5">
              <div class="h-full w-full relative">
                <FileManager v-if="panel.type === 'fileManager'" class="h-full" />
                <MonitorContainer v-else-if="panel.type === 'monitor'" class="h-full" />
                <PropertiesPanel v-else-if="panel.type === 'properties'" class="h-full" />
                <div v-else-if="panel.type === 'text'" class="h-full w-full bg-ui-bg-elevated p-4 overflow-auto border border-ui-border flex flex-col">
                  <div class="flex justify-between items-center mb-2 pb-2 border-b border-ui-border text-sm">
                    <h3 class="font-bold truncate" :title="panel.title">{{ panel.title }}</h3>
                    <UButton size="xs" variant="ghost" color="neutral" icon="i-heroicons-x-mark" @click="projectStore.removePanel(panel.id)" />
                  </div>
                  <pre class="text-xs whitespace-pre-wrap flex-1">{{ panel.fileContent }}</pre>
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
