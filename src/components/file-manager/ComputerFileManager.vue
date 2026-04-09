<script setup lang="ts">
import { ref, computed, provide, onMounted, shallowRef } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import {
  createFileManager,
  FILE_MANAGER_INJECTION_KEY,
} from '~/composables/file-manager/useFileManager';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import type { FsEntry } from '~/types/fs';
import {
  useFileManagerStore,
  useFileBrowserPersistenceStore,
  type FileViewMode,
} from '~/stores/file-manager.store';

const props = defineProps<{
  instanceId?: string;
  hideFocusFrame?: boolean;
}>();

const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const persistenceStore = useFileBrowserPersistenceStore();
const instanceId = props.instanceId || 'computer';
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const { t } = useI18n();

// Create independent state for this instance
const rootEntries = shallowRef<FsEntry[]>([]);
const sortMode = ref<'name' | 'type'>('name');

// Independent history for computer file manager
const computerHistoryStack = ref<FsEntry[]>([]);
const computerFutureStack = ref<FsEntry[]>([]);

const { vfs, rootPath } = useComputerVfs();

// Initialize file manager for computer
const fileManager = createFileManager({
  t: (key: string, params?: any) => useI18n().t(key, params),
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
  } as any,
  mediaStore: {
    revalidateMissingMedia: async () => {},
    removeMediaCache: async () => {},
  } as any,
  historyStore: {
    push: () => {},
  } as any,
  shouldRecordFileManagerHistory: () => false,
  hideCommonRoot: true,
});

const expandedPaths = ref(new Set<string>());

// Decouple computer-specific settings from the main store instance using persistence store
const computerStoreWrapper = computed(() => {
  return new Proxy(fileManagerStore, {
    get(target, prop, receiver) {
      if (prop === 'selectedFolder') return persistenceStore.computerLastFolder;
      if (prop === 'gridCardSize') return persistenceStore.computerGridCardSize;
      if (prop === 'viewMode') return persistenceStore.computerViewMode;
      if (prop === 'historyStack') return computerHistoryStack.value;
      if (prop === 'futureStack') return computerFutureStack.value;

      if (prop === 'openFolder') {
        return (entry: FsEntry | null, options: { skipHistory?: boolean } = {}) => {
          if (entry && entry.kind === 'directory') {
            if (!options.skipHistory && persistenceStore.computerLastFolder) {
              const current = { ...persistenceStore.computerLastFolder };
              if (current.path !== entry.path || current.source !== entry.source) {
                computerHistoryStack.value.push(current);
                computerFutureStack.value = [];
              }
            }
          }
          persistenceStore.setComputerLastFolder(entry);
          return target.openFolder(entry, { skipHistory: true });
        };
      }

      if (prop === 'addToHistory') {
        return (entry: FsEntry) => {
          const last = computerHistoryStack.value[computerHistoryStack.value.length - 1];
          if (last && last.path === entry.path && last.source === entry.source) return;
          computerHistoryStack.value.push({ ...entry });
          computerFutureStack.value = [];
        };
      }

      if (prop === 'setViewMode') {
        return (mode: FileViewMode) => persistenceStore.setComputerViewMode(mode);
      }

      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      if (prop === 'selectedFolder') {
        persistenceStore.setComputerLastFolder(value);
        return true;
      }
      if (prop === 'gridCardSize') {
        persistenceStore.setComputerGridCardSize(value);
        return true;
      }
      if (prop === 'viewMode') {
        persistenceStore.setComputerViewMode(value);
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });
});

provide('fileManagerStore', computerStoreWrapper.value);
provide(FILE_MANAGER_INJECTION_KEY, fileManager);

onMounted(async () => {
  let restored = false;
  if (persistenceStore.computerLastFolder) {
    try {
      // Validate that the folder still exists before trying to open it
      const exists = await vfs.value?.exists(persistenceStore.computerLastFolder.path);
      if (!exists) {
        persistenceStore.setComputerLastFolder(null);
      } else {
        computerStoreWrapper.value.openFolder(persistenceStore.computerLastFolder, {
          skipHistory: true,
        });
        restored = true;
      }
    } catch (e) {
      console.warn('Failed to validate last computer folder', e);
      persistenceStore.setComputerLastFolder(null);
    }
  }

  await fileManager.loadProjectDirectory();

  // If no folder selected or previous one was invalid, open root
  if (!restored) {
    computerStoreWrapper.value.openFolder({
      name: rootPath.value || 'Root',
      path: rootPath.value,
      kind: 'directory',
    });
  }
});

function onSelect(entry: FsEntry) {
  computerStoreWrapper.value.openFolder(entry);
  selectionStore.selectFsEntry(entry, instanceId, true);
}
</script>

<template>
  <Splitpanes class="h-full w-full editor-splitpanes computer-file-manager">
    <Pane size="30" min-size="10" class="border-r border-ui-border">
      <FileManagerPanel
        folders-only
        compact
        hide-actions
        :instance-id="instanceId"
        :is-external="true"
        hide-focus-frame
        class="h-full"
        @select="onSelect"
      />
    </Pane>
    <Pane size="70">
      <FileBrowser
        :vfs="vfs!"
        :instance-id="instanceId"
        :is-external="true"
        :hide-focus-frame="props.hideFocusFrame"
        :root-name="
          workspaceStore.workspaceProviderId === 'tauri'
            ? t('fastcat.fileManager.tabs.computer')
            : t('fastcat.fileManager.tabs.workspace')
        "
        hide-upload
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
