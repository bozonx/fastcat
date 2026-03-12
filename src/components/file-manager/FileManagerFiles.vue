<script setup lang="ts">
import { ref, computed, provide } from 'vue';
import { useAutoScroll } from '~/composables/ui/useAutoScroll';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFilesPageStore } from '~/stores/filesPage.store';
import FileManagerTree from './FileManagerTree.vue';
import type { FsEntry } from '~/types/fs';
import { useFileDrop } from '~/composables/fileManager/useFileDrop';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

const { t } = useI18n();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const proxyStore = useProxyStore();
const workspaceStore = useWorkspaceStore();
const { loadTimeline } = useProjectActions();

const scrollEl = ref<HTMLElement | null>(null);

function onContainerKeyDown(e: KeyboardEvent) {
  const container = scrollEl.value;
  if (!container) return;

  const activeEl = document.activeElement as HTMLElement;
  if (activeEl?.tagName === 'INPUT') return;

  const items = Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));
  if (items.length === 0) return;

  const currentIndex = items.indexOf(activeEl);

  if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();

    if (currentIndex === -1) {
      items[0]?.focus();
      return;
    }

    let nextIndex = currentIndex;

    if (e.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex !== currentIndex) {
      const el = items[nextIndex];
      if (el) el.focus();
    }
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // Optional: Left/Right to expand/collapse
    // For now we just let the component handle standard enter/space if we want, but left/right could also trigger the chevron click.
    // The node needs a way to expose toggle, which we emit. But we can't easily emit toggle from here without knowing the entry.
    // We can leave left/right alone for now or handle it.
  }
}

const {
  onDragOver: autoScrollDragOver,
  onDragLeave: autoScrollDragLeave,
  onDrop: autoScrollDrop,
} = useAutoScroll(scrollEl);

function onContainerDragOver(e: DragEvent) {
  if (!isRelevantDrag(e)) return;
  autoScrollDragOver(e);
}

function onContainerDrop() {
  autoScrollDrop();
}

function onContainerDragLeave(e: DragEvent) {
  autoScrollDragLeave(e);
}

const props = defineProps<{
  editingEntryPath?: string | null;
  foldersOnly?: boolean;
  isDragging: boolean;
  isLoading: boolean;
  isApiSupported: boolean;
  isFilesPage?: boolean;
  rootEntries: FsEntry[];
  getFileIcon: (entry: FsEntry) => string;
  findEntryByPath: (path: string) => FsEntry | null;
  mediaCache: Pick<ProxyThumbnailService, 'hasProxy'>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<void>;
  handleFiles: (files: FileList | File[], targetDirPath?: string) => Promise<void>;
}>();

const filesPageStore = useFilesPageStore();
const selectedPath = computed(() => {
  if (props.isFilesPage) {
    return filesPageStore.selectedFolder?.path ?? projectStore.currentProjectName ?? null;
  }
  return uiStore.selectedFsEntry?.path ?? null;
});

const mediaUsageMap = computed(() => timelineMediaUsageStore.mediaPathToTimelines);

provide('fileManagerTreeCtx', {
  getFileIcon: props.getFileIcon,
  selectedPath,
  getEntryMeta,
});

function getEntryMeta(entry: FsEntry): {
  hasProxy: boolean;
  generatingProxy: boolean;
  proxyProgress?: number;
  isUsedInTimeline?: boolean;
} {
  if (entry.kind !== 'file' || !entry.path) {
    return { hasProxy: false, generatingProxy: false };
  }

  const hasProxy = props.mediaCache.hasProxy(entry.path);
  const generatingProxy = proxyStore.generatingProxies.has(entry.path);
  const proxyProgress = proxyStore.proxyProgress[entry.path];
  const isUsedInTimeline = Boolean(mediaUsageMap.value[entry.path]?.length);
  return { hasProxy, generatingProxy, proxyProgress, isUsedInTimeline };
}

async function onRequestMove(params: { sourcePath: string; targetDirPath: string }) {
  const source = props.findEntryByPath(params.sourcePath);
  if (!source) return;
  await props.moveEntry({
    source,
    targetDirPath: params.targetDirPath,
  });
  uiStore.notifyFileManagerUpdate();
}

async function onRequestUpload(params: { files: File[]; targetDirPath: string }) {
  await props.handleFiles(params.files, params.targetDirPath);
  uiStore.notifyFileManagerUpdate();
}

function onRequestDownload(params: { entry: RemoteFsEntry; targetDirPath: string }) {
  uiStore.pendingRemoteDownloadRequest = params;
}

const { isRootDropOver, isRelevantDrag, onRootDragOver, onRootDragLeave, onRootDrop } = useFileDrop(
  {
    resolveEntryByPath: async (path: string) => props.findEntryByPath(path),
    handleFiles: props.handleFiles,
    moveEntry: props.moveEntry,
  },
);

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (e: 'select', entry: FsEntry): void;
  (
    e: 'action',
    action:
      | 'refresh'
      | 'rename'
      | 'delete'
      | 'addToTimeline'
      | 'createProxy'
      | 'cancelProxy'
      | 'deleteProxy'
      | 'upload'
      | 'createProxyForFolder'
      | 'cancelProxyForFolder'
      | 'createMarkdown'
      | 'createTimeline'
      | 'createFolder'
      | 'openAsPanelCut'
      | 'openAsPanelSound'
      | 'openAsProjectTab'
      | 'createOtioVersion'
      | 'convertFile'
      | 'uploadRemote'
      | 'transcribe'
      | 'extractAudio',
    entry: FsEntry,
  ): void;
  (e: 'commitRename', entry: FsEntry, newName: string): void;
  (e: 'stopRename'): void;
}>();

const rootContextMenuItems = computed(() => {
  if (!projectStore.currentProjectName) return [];
  const rootEntry: FsEntry = {
    kind: 'directory',
    name: projectStore.currentProjectName,
    path: '',
  };

  return [
    [
      {
        label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: async () => emit('action', 'upload', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: async () => emit('action', 'createFolder', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline'),
        icon: 'i-heroicons-document-plus',
        onSelect: async () => emit('action', 'createTimeline', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
        icon: 'i-heroicons-document-text',
        onSelect: async () => emit('action', 'createMarkdown', rootEntry),
      },
    ],
    [
      {
        label: t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree'),
        icon: 'i-heroicons-arrow-path',
        disabled: props.isLoading,
        onSelect: () => emit('action', 'refresh', rootEntry),
      },
    ],
  ];
});

function selectProjectRoot() {
  const name = projectStore.currentProjectName;
  if (!name) return;

  const rootEntry: FsEntry = {
    kind: 'directory',
    name,
    path: '',
  };

  uiStore.selectedFsEntry = {
    kind: 'directory',
    name,
    path: '',
  };

  selectionStore.selectFsEntry(rootEntry);
  emit('select', rootEntry);
}

function getVisibleEntries(entries: FsEntry[]): FsEntry[] {
  const list: FsEntry[] = [];
  for (const e of entries) {
    list.push(e);
    if (e.kind === 'directory' && e.expanded && e.children) {
      list.push(...getVisibleEntries(e.children));
    }
  }
  return list;
}

async function onEntrySelect(entry: FsEntry, event?: MouseEvent) {
  if (event && !props.isFilesPage) {
    const isL1 = isLayer1Active(event, workspaceStore.userSettings);
    const isL2 = isLayer2Active(event, workspaceStore.userSettings);

    if (isL2) {
      const selected = selectionStore.selectedEntity;
      if (selected && selected.source === 'fileManager') {
        let currentEntries: FsEntry[] = [];
        if (selected.kind === 'multiple') {
          currentEntries = [...selected.entries];
        } else if (selected.kind === 'file' || selected.kind === 'directory') {
          currentEntries = [selected.entry];
        }

        const existingIndex = currentEntries.findIndex((e) => e.path === entry.path);
        if (existingIndex >= 0) {
          currentEntries.splice(existingIndex, 1);
          selectionStore.selectFsEntries(currentEntries);
        } else {
          // Enforce same level rule
          if (currentEntries.length > 0) {
            const firstParentPath = currentEntries[0]?.path
              ? currentEntries[0].path.split('/').slice(0, -1).join('/')
              : '';
            const entryParentPath = entry.path ? entry.path.split('/').slice(0, -1).join('/') : '';
            if (firstParentPath === entryParentPath) {
              selectionStore.selectFsEntries([...currentEntries, entry]);
            } else {
              selectionStore.selectFsEntry(entry);
              uiStore.selectedFsEntry = {
                kind: entry.kind,
                name: entry.name,
                path: entry.path,
                parentPath: entry.parentPath,
                lastModified: entry.lastModified,
                size: entry.size,
              };
            }
          } else {
            selectionStore.selectFsEntries([entry]);
          }
        }
      } else {
        selectionStore.selectFsEntry(entry);
        uiStore.selectedFsEntry = {
          kind: entry.kind,
          name: entry.name,
          path: entry.path,
          parentPath: entry.parentPath,
          lastModified: entry.lastModified,
          size: entry.size,
        };
      }
      return;
    } else if (isL1) {
      const selected = selectionStore.selectedEntity;
      if (selected && selected.source === 'fileManager') {
        const visibleEntries = getVisibleEntries(props.rootEntries);
        const targetIndex = visibleEntries.findIndex((e) => e.path === entry.path);

        let lastSelectedIndex = -1;
        if (selected.kind === 'multiple' && selected.entries.length > 0) {
          const lastSelected = selected.entries[selected.entries.length - 1];
          lastSelectedIndex = visibleEntries.findIndex((e) => e.path === lastSelected?.path);
        } else if ('path' in selected) {
          lastSelectedIndex = visibleEntries.findIndex((e) => e.path === selected.path);
        }

        if (lastSelectedIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(lastSelectedIndex, targetIndex);
          const end = Math.max(lastSelectedIndex, targetIndex);
          let range = visibleEntries.slice(start, end + 1);

          // Enforce same level rule
          const entryParentPath = entry.path ? entry.path.split('/').slice(0, -1).join('/') : '';
          range = range.filter((e) => {
            const eParentPath = e.path ? e.path.split('/').slice(0, -1).join('/') : '';
            return eParentPath === entryParentPath;
          });

          selectionStore.selectFsEntries(range);
        } else {
          selectionStore.selectFsEntry(entry);
          uiStore.selectedFsEntry = {
            kind: entry.kind,
            name: entry.name,
            path: entry.path,
            parentPath: entry.parentPath,
            lastModified: entry.lastModified,
            size: entry.size,
          };
        }
      } else {
        selectionStore.selectFsEntry(entry);
        uiStore.selectedFsEntry = {
          kind: entry.kind,
          name: entry.name,
          path: entry.path,
          parentPath: entry.parentPath,
          lastModified: entry.lastModified,
          size: entry.size,
        };
      }
      return;
    }
  }

  uiStore.selectedFsEntry = {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    parentPath: entry.parentPath,
    lastModified: entry.lastModified,
    size: entry.size,
  };

  selectionStore.selectFsEntry(entry);
  emit('select', entry);

  if (entry.kind === 'file') {
    focusStore.setTempFocus('left');
  }

  if (entry.kind !== 'file') return;
  if (!entry.path?.toLowerCase().endsWith('.otio')) return;

  await loadTimeline(entry.path);
}
</script>

<template>
  <div
    ref="scrollEl"
    class="flex-1 overflow-auto min-h-0 min-w-0 relative"
    @dragover="onContainerDragOver"
    @dragleave="onContainerDragLeave"
    @drop.capture="onContainerDrop"
    @drop="onContainerDrop"
    @keydown="onContainerKeyDown"
  >
    <UContextMenu :items="rootContextMenuItems">
      <div class="min-w-full w-max min-h-full flex flex-col" @pointerdown.self="selectProjectRoot">
        <div
          v-if="rootEntries.length === 0"
          class="flex flex-col items-center justify-center flex-1 w-full gap-3 text-ui-text-disabled px-4 text-center min-h-50"
        >
          <UIcon name="i-heroicons-folder-open" class="w-10 h-10" />
          <p class="text-sm">
            {{
              isApiSupported
                ? t('videoEditor.fileManager.empty', 'No files in this project')
                : t(
                    'videoEditor.fileManager.unsupported',
                    'File System Access API is not supported in this browser',
                  )
            }}
          </p>
        </div>

        <!-- File tree -->
        <div v-else class="flex flex-col flex-1">
          <FileManagerTree
            :editing-entry-path="editingEntryPath"
            :entries="rootEntries"
            :depth="0"
            :folders-only="foldersOnly"
            :is-files-page="isFilesPage"
            @commit-rename="(entry, name) => emit('commitRename', entry, name)"
            @stop-rename="emit('stopRename')"
            @toggle="emit('toggle', $event)"
            @select="onEntrySelect"
            @action="(action, entry) => emit('action', action as any, entry)"
            @request-move="onRequestMove"
            @request-upload="onRequestUpload"
            @request-download="onRequestDownload"
          />
        </div>

        <div
          class="flex-1 w-full min-w-full flex items-center justify-center min-h-12"
          :class="{
            'bg-primary-500/10 outline outline-primary-500/40 -outline-offset-1': isRootDropOver,
          }"
          @dragover.prevent="onRootDragOver"
          @dragleave.prevent="onRootDragLeave"
          @drop.prevent="onRootDrop"
          @pointerdown="selectProjectRoot"
        >
          <p v-if="isRootDropOver" class="text-xs font-medium text-primary-400 text-center">
            {{
              t(
                'videoEditor.fileManager.actions.dropToRootHint',
                'Release to upload into the project root',
              )
            }}
          </p>
        </div>
      </div>
    </UContextMenu>
  </div>
</template>
