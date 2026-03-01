<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import { useProjectStore } from '~/stores/project.store';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';

const projectStore = useProjectStore();
const { currentProjectId } = storeToRefs(projectStore);

const { sizes: mainSizes, onResized: onMainResize } = usePersistedSplitpanes(
  'sound-main',
  currentProjectId,
  [60, 40],
);
const { sizes: topSizes, onResized: onTopResize } = usePersistedSplitpanes(
  'sound-top',
  currentProjectId,
  [50, 50],
);
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes" horizontal @resized="onMainResize">
      <Pane :size="mainSizes[0]" min-size="10">
        <Splitpanes class="editor-splitpanes" @resized="onTopResize">
          <Pane :size="topSizes[0]" min-size="10">
            <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
              <h3 class="font-bold mb-2">Звук: Панель 1</h3>
            </div>
          </Pane>
          <Pane :size="topSizes[1]" min-size="10">
            <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
              <h3 class="font-bold mb-2">Звук: Панель 2</h3>
            </div>
          </Pane>
        </Splitpanes>
      </Pane>
      <Pane :size="mainSizes[1]" min-size="10">
        <div class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted">
          <h3 class="font-bold mb-2">Звук: Таймлайн</h3>
        </div>
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
