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
import { useFileManager } from '~/composables/fileManager/useFileManager';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const { currentProjectId } = storeToRefs(projectStore);
const { t } = useI18n();
const { getProjectRootDirHandle } = useFileManager();

const { sizes, onResized } = usePersistedSplitpanes('files', currentProjectId, [20, 60, 20]);

async function navigateToParentFolder() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) return;

  // Already at root — nothing to do
  const currentPath = folder.path ?? '';
  if (!currentPath) return;

  const rootHandle = await getProjectRootDirHandle();
  if (!rootHandle) return;

  const parts = currentPath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    // Navigate to project root
    filesPageStore.selectFolder({
      kind: 'directory',
      name: projectStore.currentProjectName || '',
      path: '',
      handle: rootHandle,
    });
  } else {
    // Navigate to parent folder
    const parentParts = parts.slice(0, -1);
    let currentHandle: FileSystemDirectoryHandle = rootHandle;
    for (const part of parentParts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      } catch {
        return;
      }
    }
    filesPageStore.selectFolder({
      kind: 'directory',
      name: parentParts[parentParts.length - 1] || '',
      path: parentParts.join('/'),
      handle: currentHandle,
    });
  }
}

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace') return;
  if (isEditableTarget(e.target)) return;

  e.preventDefault();
  // Stop editor hotkeys from processing Backspace as timeline.rippleDelete
  e.stopImmediatePropagation();

  void navigateToParentFolder();
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
        <PropertiesPanel
          :is-files-page="true"
          :entity="selectionStore.selectedEntity"
          class="h-full"
        />
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
