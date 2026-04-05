<script setup lang="ts">
import { ref, computed, provide, onMounted, shallowRef } from 'vue';
import { Pane, Splitpanes } from 'splitpanes';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createFileManager, FILE_MANAGER_INJECTION_KEY } from '~/composables/file-manager/useFileManager';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import type { FsEntry } from '~/types/fs';

const props = defineProps<{
    instanceId?: string;
    hideFocusFrame?: boolean;
}>();

const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();
const instanceId = props.instanceId || 'computer';
const workspaceStore = useWorkspaceStore();
const { t } = useI18n();

// Create independent state for this instance
const rootEntries = shallowRef<FsEntry[]>([]);
const sortMode = ref<'name' | 'type'>('name');

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
  isFileTreePathExpanded: (path) => !!expandedPaths.value.has(path),
  setFileTreePathExpanded: (path, expanded) => {
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

// Wrap the store to use "computer" specific persisted values
const computerStoreWrapper = computed(() => {
  return new Proxy(fileManagerStore, {
    get(target, prop, receiver) {
      if (prop === 'selectedFolder') return target.computerLastFolder;
      if (prop === 'gridCardSize') return target.computerGridCardSize;
      if (prop === 'viewMode') return target.computerViewMode;
      
      if (prop === 'openFolder') {
        return (entry: FsEntry | null) => {
          target.setComputerLastFolder(entry);
          return target.openFolder(entry);
        };
      }

      if (prop === 'setViewMode') {
        return (mode: FileViewMode) => target.setComputerViewMode(mode);
      }

      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (prop === 'selectedFolder') {
        target.setComputerLastFolder(value);
        return true;
      }
      if (prop === 'gridCardSize') {
        target.setComputerGridCardSize(value);
        return true;
      }
      if (prop === 'viewMode') {
        target.setComputerViewMode(value);
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    }
  });
});

provide('fileManagerStore', computerStoreWrapper.value);
provide(FILE_MANAGER_INJECTION_KEY, fileManager);

onMounted(async () => {
  if (fileManagerStore.computerLastFolder) {
      // Ensure we don't try to open a folder that doesn't exist anymore or is from another adapter
  }
  
  await fileManager.loadProjectDirectory();
  
  // If no folder selected, open root
  if (!fileManagerStore.computerLastFolder) {
      computerStoreWrapper.value.openFolder({
          name: rootPath.value || 'Root',
          path: rootPath.value,
          kind: 'directory',
      });
  }
});


function onSelect(entry: FsEntry) {
    fileManagerStore.setComputerLastFolder(entry);
}
</script>

<template>
  <div class="h-full w-full computer-file-manager">
    <Splitpanes class="h-full editor-splitpanes">
      <Pane size="30" min-size="10" class="border-r border-ui-border">
        <FileManagerPanel
          folders-only
          compact
          hide-actions
          :instance-id="instanceId"
          hide-focus-frame
          class="h-full"
          @select="onSelect"
        />
      </Pane>
      <Pane size="70">
        <FileBrowser 
            :vfs="vfs!" 
            :instance-id="instanceId"
            :hide-focus-frame="props.hideFocusFrame"
            :root-name="workspaceStore.workspaceProviderId === 'tauri' ? t('fastcat.fileManager.tabs.computer') : t('fastcat.fileManager.tabs.workspace')"
            hide-upload
            class="h-full"
        />
      </Pane>

    </Splitpanes>
  </div>
</template>

<style scoped>
.computer-file-manager :deep(.splitpanes__splitter) {
  width: 1px;
  background-color: var(--ui-border);
}
</style>
