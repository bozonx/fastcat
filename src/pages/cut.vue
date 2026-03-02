<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { useProjectStore } from '~/stores/project.store';

const projectStore = useProjectStore();
const { currentProjectId } = storeToRefs(projectStore);

const { sizes: mainSplitSizes, onResized: onMainSplitResize } = usePersistedSplitpanes(
  'cut-main',
  currentProjectId,
  [40, 60],
);
const { sizes: topSplitSizes, onResized: onTopSplitResize } = usePersistedSplitpanes(
  'cut-top',
  currentProjectId,
  [20, 60, 20],
);
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes" horizontal @resized="onMainSplitResize">
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
</template>
