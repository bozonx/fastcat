<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import { useFilesPageStore } from '~/stores/files-page.store';

const filesPageStore = useFilesPageStore();
</script>

<template>
  <Splitpanes class="editor-splitpanes h-full">
    <Pane size="30" min-size="15">
      <FileManagerPanel
        folders-only
        disable-sort
        is-files-page
        class="h-full"
        @select="filesPageStore.selectFolder"
      />
    </Pane>
    <Pane size="70" min-size="20">
      <FileBrowser class="h-full" />
    </Pane>
  </Splitpanes>
</template>
