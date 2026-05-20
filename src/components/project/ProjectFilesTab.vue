<script setup lang="ts">
import { inject, computed } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import { useFileManagerStore } from '~/stores/file-manager.store';

defineProps<{
  compact?: boolean;
}>();

const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();

const DEFAULT_TREE_SIZE = 30;
const treeSize = computed(() => fileManagerStore.treeSize ?? DEFAULT_TREE_SIZE);
const listSize = computed(() => 100 - treeSize.value);

function onResized(event: { panes: Array<{ size: number }> }) {
  const next = event.panes[0]?.size;
  if (typeof next === 'number') fileManagerStore.setTreeSize(next);
}
</script>

<template>
  <Splitpanes class="editor-splitpanes h-full" @resized="onResized">
    <Pane :size="treeSize" min-size="15">
      <FileManagerPanel
        folders-only
        is-files-page
        :compact="compact"
        instance-id="editor-main"
        hide-focus-frame
        hide-project-label
        class="h-full"
        @select="fileManagerStore.openFolder"
      />
    </Pane>
    <Pane :size="listSize" min-size="20">
      <FileBrowser
        :compact="compact"
        instance-id="editor-main"
        hide-focus-frame
        hide-view-switcher
        hide-breadcrumbs
        class="h-full"
      />
    </Pane>
  </Splitpanes>
</template>
