<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useEditorViewStore } from '~/stores/editorView.store';

import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import Timeline from '~/components/Timeline.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';

const viewStore = useEditorViewStore();
const filesPageStore = useFilesPageStore();

const { sizes: mainSplitSizes, onResized: onMainSplitResize } = usePersistedSplitpanes(
  'gran-editor-main-split-v4',
  [40, 60],
);
const { sizes: topSplitSizes, onResized: onTopSplitResize } = usePersistedSplitpanes(
  'gran-editor-top-split-v4',
  [20, 60, 20],
);
</script>

<template>
  <ClientOnly>
    <!-- Files View -->
    <div v-if="viewStore.currentView === 'files'" class="h-screen">
      <Splitpanes class="flex-1 min-h-0 editor-splitpanes">
        <Pane min-size="10">
          <FileManager folders-only class="h-full" @select="filesPageStore.selectFolder" />
        </Pane>
        <Pane min-size="10">
          <FileBrowser class="h-full" />
        </Pane>
        <Pane min-size="10">
          <PropertiesPanel :entity="filesPageStore.selectedEntity" class="h-full" />
        </Pane>
      </Splitpanes>
    </div>

    <!-- Cut View (Main Editor) -->
    <div v-else-if="viewStore.currentView === 'cut'" class="h-screen">
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
              <MonitorContainer class="h-full" />
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
    </div>

    <!-- Sound View -->
    <div v-else-if="viewStore.currentView === 'sound'" class="h-screen">
      <Splitpanes class="flex-1 min-h-0 editor-splitpanes" horizontal>
        <Pane size="60" min-size="10">
          <Splitpanes class="editor-splitpanes">
            <Pane min-size="10">
              <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
                <h3 class="font-bold mb-2">Звук: Панель 1</h3>
              </div>
            </Pane>
            <Pane min-size="10">
              <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
                <h3 class="font-bold mb-2">Звук: Панель 2</h3>
              </div>
            </Pane>
          </Splitpanes>
        </Pane>
        <Pane size="40" min-size="10">
          <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
            <h3 class="font-bold mb-2">Звук: Таймлайн</h3>
          </div>
        </Pane>
      </Splitpanes>
    </div>

    <!-- Fullscreen View -->
    <div v-else-if="viewStore.currentView === 'fullscreen'" class="h-screen w-screen bg-ui-bg text-ui-text overflow-hidden">
      <MonitorContainer is-fullscreen />
    </div>
  </ClientOnly>
</template>
