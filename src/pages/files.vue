<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import FileManager from '~/components/FileManager.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const { currentProjectId } = storeToRefs(projectStore);
const { t } = useI18n();

const { sizes, onResized } = usePersistedSplitpanes('files', currentProjectId, [20, 60, 20]);

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace') return;
  if (isEditableTarget(e.target)) return;

  e.preventDefault();
  window.history.back();
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
});
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes" @resized="onResized">
      <Pane :size="sizes[0]" min-size="10">
        <FileManager
          folders-only
          disable-sort
          :is-files-page="true"
          class="h-full"
          @select="filesPageStore.selectFolder"
        />
      </Pane>
      <Pane :size="sizes[1]" min-size="10">
        <FileBrowser :is-files-page="true" class="h-full" />
      </Pane>
      <Pane :size="sizes[2]" min-size="10">
        <PropertiesPanel :is-files-page="true" :entity="selectionStore.selectedEntity" class="h-full" />
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
