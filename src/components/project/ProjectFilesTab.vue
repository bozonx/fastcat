<script setup lang="ts">
import { inject } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import { useFileManagerStore } from '~/stores/file-manager.store';

const props = defineProps<{
  compact?: boolean;
}>();

const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();
</script>

<template>
  <Splitpanes class="editor-splitpanes h-full">
    <Pane size="30" min-size="15">
      <FileManagerPanel
        folders-only
        is-files-page
        :compact="compact"
        class="h-full"
        @select="fileManagerStore.openFolder"
      />
    </Pane>
    <Pane size="70" min-size="20">
      <FileBrowser :compact="compact" class="h-full" />
    </Pane>
  </Splitpanes>
</template>
