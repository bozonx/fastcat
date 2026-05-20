<script setup lang="ts">
import { ref, computed, provide, onMounted, shallowRef, inject } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useComputerSidebarStore, useFileManagerStore } from '~/stores/file-manager.store';
import {
  createFileManager,
  FILE_MANAGER_INJECTION_KEY,
} from '~/composables/file-manager/useFileManager';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import type { FsEntry } from '~/types/fs';

const props = defineProps<{
  instanceId?: string;
  hideFocusFrame?: boolean;
}>();

const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const instanceId = props.instanceId || 'computer';
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const { t } = useI18n();
const rootSelectionEntry = computed<FsEntry>(() => ({
  name:
    workspaceStore.workspaceProviderId === 'tauri'
      ? t('fastcat.fileManager.tabs.computer')
      : t('fastcat.fileManager.tabs.workspace'),
  path: '',
  kind: 'directory',
  source: 'local',
}));

// Create independent state for this instance
const rootEntries = shallowRef<FsEntry[]>([]);
const sortMode = ref<'name' | 'type'>('name');

const { vfs } = useComputerVfs();

// Initialize file manager for computer
const fileManager = createFileManager({
  t: (key: string, params?: Record<string, unknown>) => useI18n().t(key, params),
  toast: useToast(),
  vfs: vfs.value!,
  isApiSupported: ref(true),
  rootEntries,
  sortMode,
  showHiddenFiles: ref(true),
  isFileTreePathExpanded: (path: string) => !!expandedPaths.value.has(path),
  setFileTreePathExpanded: (path: string, expanded: boolean) => {
    if (expanded) expandedPaths.value.add(path);
    else expandedPaths.value.delete(path);
  },
  getExpandedPaths: () => Array.from(expandedPaths.value),
  getWorkspaceHandle: () => null,
  getProjectName: () => 'Computer',
  getProjectId: () => 'computer',
  getProjectSize: () => ({ width: 1920, height: 1080 }),
  onMediaImported: () => {},
  mediaCache: {
    hasProxy: () => false,
    checkExistingProxies: async () => [],
    ensureProxy: async () => {},
    cancelProxy: async () => {},
    removeProxy: async () => {},
    renameProxy: async () => {},
    renameProxyDir: async () => {},
    clearExistingProxies: () => {},
    clearVideoThumbnails: async () => {},
    clearWaveforms: async () => {},
  } as unknown,
  mediaStore: {
    revalidateMissingMedia: async () => {},
    removeMediaCache: async () => {},
    resetMediaState: () => {},
  } as unknown,
  historyStore: {
    push: () => {},
  } as unknown,
  shouldRecordFileManagerHistory: () => false,
  hideCommonRoot: true,
});

const expandedPaths = ref(new Set<string>());

fileManagerStore.setSelectionContext({
  instanceId,
  isExternal: true,
});

provide(FILE_MANAGER_INJECTION_KEY, fileManager);

// Persistence of the last visited folder is now handled internally by fileManagerStore + WorkspaceStore

onMounted(async () => {
  let restored = false;

  // Restore last folder from workspace state if available
  const contextId = instanceId === 'sidebar' ? 'computer-sidebar' : instanceId;
  const lastPath = workspaceStore.workspaceState.fileBrowser.instances[contextId]?.lastPath;

  if (lastPath) {
    try {
      // Validate the folder still exists before restoring navigation
      const exists = await vfs.value?.exists(lastPath);
      if (exists) {
        fileManagerStore.openFolderByPath(lastPath);
        restored = true;
      }
    } catch (e) {
      console.warn('Failed to validate last computer folder', e);
    }
  }

  await fileManager.loadProjectDirectory();

  if (!restored) {
    fileManagerStore.openFolder(rootSelectionEntry.value);
  }
});

function onSelect(entry: FsEntry) {
  fileManagerStore.openFolder(entry);
  selectionStore.selectFsEntry(entry, instanceId, true);
}

// Tree size lives in the dedicated computer-sidebar store regardless of
// the locally injected fileManagerStore (which may be project-scoped).
const computerSidebarStore = useComputerSidebarStore();
const DEFAULT_TREE_SIZE = 30;
const treeSize = computed(() => computerSidebarStore.treeSize ?? DEFAULT_TREE_SIZE);
const listSize = computed(() => 100 - treeSize.value);

function onResized(event: { panes: Array<{ size: number }> }) {
  const next = event.panes[0]?.size;
  if (typeof next === 'number') computerSidebarStore.setTreeSize(next);
}
</script>

<template>
  <Splitpanes class="h-full w-full editor-splitpanes computer-file-manager" @resized="onResized">
    <Pane :size="treeSize" min-size="10" class="border-r border-ui-border">
      <FileManagerPanel
        folders-only
        compact
        hide-actions
        :instance-id="instanceId"
        :is-external="true"
        :root-selection-entry="rootSelectionEntry"
        hide-focus-frame
        class="h-full"
        @select="onSelect"
      />
    </Pane>
    <Pane :size="listSize">
      <FileBrowser
        :vfs="vfs!"
        :instance-id="instanceId"
        :is-external="true"
        :hide-focus-frame="props.hideFocusFrame"
        :root-name="rootSelectionEntry.name"
        hide-upload
        hide-select-unused
        class="h-full"
      />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.computer-file-manager :deep(.splitpanes__splitter) {
  width: 1px;
  background-color: var(--ui-border);
}
</style>
