<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useProjectStore } from '~/stores/project.store';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const { currentProjectId } = storeToRefs(projectStore);
const { t } = useI18n();

const { sizes, onResized } = usePersistedSplitpanes(
  'files',
  currentProjectId,
  [20, 60, 20],
);
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes" @resized="onResized">
      <Pane :size="sizes[0]" min-size="10">
        <FileManager folders-only class="h-full" @select="filesPageStore.selectFolder" />
      </Pane>
      <Pane :size="sizes[1]" min-size="10">
        <FileBrowser class="h-full" />
      </Pane>
      <Pane :size="sizes[2]" min-size="10">
        <PropertiesPanel :entity="filesPageStore.selectedEntity" class="h-full" />
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
