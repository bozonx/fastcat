<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const { currentProjectId } = storeToRefs(projectStore);
const { getProjectRootDirHandle, getWorkspaceCommonDirHandle, findEntryByPath } = useFileManager();

const { sizes, onResized } = usePersistedSplitpanes('files', currentProjectId, [20, 60, 20]);

async function navigateToParentFolder() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) return;

  const currentPath = folder.path ?? '';
  if (!currentPath) return;

  const parentPath = getWorkspacePathParent(currentPath);
  if (!parentPath) {
    filesPageStore.selectFolder({
      kind: 'directory',
      name: projectStore.currentProjectName || '',
      path: '',
      handle: (await getProjectRootDirHandle()) as FileSystemDirectoryHandle,
    });
    return;
  }

  if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
    const commonHandle = await getWorkspaceCommonDirHandle();
    if (!commonHandle) return;
    filesPageStore.selectFolder({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
      handle: commonHandle,
    });
    return;
  }

  const parentEntry = findEntryByPath(parentPath);
  if (parentEntry && parentEntry.kind === 'directory') {
    filesPageStore.selectFolder(parentEntry);
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
        <FileManagerPanel
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
