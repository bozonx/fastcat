<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

interface Props {
  sizes: number[];
  selectedEntity: SelectedEntity | null;
}

defineProps<Props>();

const emit = defineEmits<{
  resized: [event: { panes: Array<{ size: number }> }];
  selectFolder: [entry: FsEntry | null];
  clearSelection: [];
}>();
</script>

<template>
  <Splitpanes
    class="editor-splitpanes"
    @resized="(event: { panes: Array<{ size: number }> }) => emit('resized', event)"
  >
    <Pane :size="sizes[0]" min-size="10">
      <FileManagerPanel
        folders-only
        is-files-page
        class="h-full"
        @select="(entry) => emit('selectFolder', entry)"
      />
    </Pane>
    <Pane :size="sizes[1]" min-size="10">
      <FileBrowser class="h-full" />
    </Pane>
    <Pane :size="sizes[2]" min-size="10">
      <PropertiesPanel
        :entity="selectedEntity"
        class="h-full"
        @clear-selection="emit('clearSelection')"
      />
    </Pane>
  </Splitpanes>
</template>
