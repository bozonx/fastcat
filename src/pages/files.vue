<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes';
import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';

const filesPageStore = useFilesPageStore();
const { t } = useI18n();
</script>

<template>
  <ClientOnly>
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
  </ClientOnly>
</template>
