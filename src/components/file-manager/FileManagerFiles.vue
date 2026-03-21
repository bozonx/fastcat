<script setup lang="ts">
import { ref, computed, provide, watch, nextTick } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useAutoScroll } from '~/composables/ui/useAutoScroll';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useFocusableListNavigation } from '~/composables/fileManager/useFocusableListNavigation';
import FileManagerTree from './FileManagerTree.vue';
import type { FsEntry } from '~/types/fs';
import { useFileDrop } from '~/composables/fileManager/useFileDrop';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { useFileManagerSelection } from '~/composables/fileManager/useFileManagerSelection';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

const { t } = useI18n();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const proxyStore = useProxyStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();
const { currentDragOperation } = clipboardStore;
const { loadTimeline } = useProjectActions();

const scrollEl = ref<HTMLElement | null>(null);

function scrollToSelectedEntry(path: string): boolean {
  const container = scrollEl.value;
  if (!container) return false;

  const targetNode = container.querySelector<HTMLElement>(
    `[data-entry-path="${CSS.escape(path)}"]`,
  );
  if (!targetNode) return false;

  targetNode.scrollIntoView({ block: 'nearest' });
  return true;
}

watch(
  () => uiStore.selectedFsEntry,
  async (newEntry) => {
    if (!newEntry?.path) return;
    const path = newEntry.path;

    await nextTick();
    requestAnimationFrame(() => {
      // First attempt — tree may not have re-rendered yet after toggleDirectory
      if (!scrollToSelectedEntry(path)) {
        // Retry after another paint cycle
        requestAnimationFrame(() => scrollToSelectedEntry(path));
      }
    });
  },
);

watch(
  () => uiStore.scrollToFileTreeEntryTrigger,
  async () => {
    const path = uiStore.scrollToFileTreeEntryPath;
    if (!path) return;

    await nextTick();
    requestAnimationFrame(() => {
      if (!scrollToSelectedEntry(path)) {
        requestAnimationFrame(() => scrollToSelectedEntry(path));
      }
    });
  },
);

const { onKeyDown: onContainerKeyDown } = useFocusableListNavigation({
  containerRef: scrollEl,
});

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

function onTreeContainerKeyDown(e: KeyboardEvent) {
  const isMod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (isMod && key === 'a') {
    e.preventDefault();
    e.stopPropagation();
    uiStore.fileTreeSelectAllTrigger++;
    return;
  }

  if (isMod && key === 'v') {
    e.preventDefault();
    e.stopPropagation();
    // Paste into selected entry (or root if nothing directory selected)
    const entry = props.findEntryByPath(selectedPath.value ?? '') ??
      ({ kind: 'directory', path: '', name: 'root' } as FsEntry);
    props.onPasteToEntry?.(entry);
    return;
  }

  if (isMod && key === 'c') {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager') {
      e.preventDefault();
      e.stopPropagation();
      const entries = selected.kind === 'multiple' ? selected.entries : [selected.entry];
      props.onCopyEntries?.(entries);
    }
    return;
  }

  if (isMod && key === 'x') {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager') {
      e.preventDefault();
      e.stopPropagation();
      const entries = selected.kind === 'multiple' ? selected.entries : [selected.entry];
      props.onCutEntries?.(entries);
    }
    return;
  }

  onContainerKeyDown(e);
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
  copyEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  handleFiles: (files: FileList | File[], targetDirPath?: string) => Promise<void>;
  onCopyEntries?: (entries: FsEntry[]) => void;
  onCutEntries?: (entries: FsEntry[]) => void;
  onPasteToEntry?: (entry: FsEntry) => void;
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
  const proxyProgress = proxyStore.proxyProgress.get(entry.path) ?? 0;
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

async function onRequestCopy(params: { sourcePath: string; targetDirPath: string }) {
  const source = props.findEntryByPath(params.sourcePath);
  if (!source) return;
  await props.copyEntry({
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
    copyEntry: props.copyEntry,
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
      | 'extractAudio'
      | 'paste',
    entry: FsEntry,
  ): void;
  (
    e: 'requestCopy',
    params: {
      sourcePath: string;
      targetDirPath: string;
    },
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

  const menu: Record<string, any>[][] = [
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

  if (clipboardStore.hasFileManagerPayload) {
    if (menu[0]) {
      menu[0].push({
        label: t('common.paste', 'Paste'),
        icon: 'i-heroicons-clipboard',
        onSelect: async () => emit('action', 'paste', rootEntry),
      });
    }
  }

  return menu;
});

function selectProjectRoot() {
  const name = projectStore.currentProjectName;
  if (!name) return;

  const rootEntry: FsEntry = {
    kind: 'directory',
    name,
    path: '',
  };

  selectSingle(rootEntry);
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

const { handleEntryClick: handleSelectionClick, selectSingle } = useFileManagerSelection({
  getVisibleEntries: () => getVisibleEntries(props.rootEntries),
  onSingleSelect: (entry) => emit('select', entry),
});

async function onEntrySelect(entry: FsEntry, event?: MouseEvent) {
  if (event && !props.isFilesPage) {
    handleSelectionClick(event, entry);
    focusStore.setTempFocus('left');
    if (entry.kind === 'file' && entry.path?.toLowerCase().endsWith('.otio')) {
      await loadTimeline(entry.path);
    }
    return;
  }

  selectSingle(entry);

  focusStore.setTempFocus('left');
  if (entry.kind === 'file' && entry.path?.toLowerCase().endsWith('.otio')) {
    await loadTimeline(entry.path);
  }
}
</script>

<template>
  <div
    ref="scrollEl"
    class="flex-1 overflow-auto min-h-0 min-w-0 relative"
    @dragover="onContainerDragOver"
    @dragleave="onContainerDragLeave"
    @drop.prevent="onContainerDrop"
    @keydown="onTreeContainerKeyDown"
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
            @request-copy="onRequestCopy"
            @request-upload="onRequestUpload"
            @request-download="onRequestDownload"
          />
        </div>

        <div
          class="flex-1 w-full min-w-full flex items-center justify-center min-h-12"
          :class="{
            'bg-primary-500/10 outline outline-primary-500/40 -outline-offset-1':
              isRootDropOver && currentDragOperation !== 'copy',
            'bg-emerald-500/10 outline outline-emerald-500/40 -outline-offset-1':
              isRootDropOver && currentDragOperation === 'copy',
          }"
          @dragover.prevent="onRootDragOver"
          @dragleave.prevent="onRootDragLeave"
          @drop.prevent="onRootDrop"
          @pointerdown="selectProjectRoot"
        >
          <p
            v-if="isRootDropOver"
            class="text-xs font-medium text-center"
            :class="currentDragOperation === 'copy' ? 'text-emerald-400' : 'text-primary-400'"
          >
            {{
              currentDragOperation === 'copy'
                ? t(
                    'videoEditor.fileManager.actions.dropToRootCopyHint',
                    'Release to copy into the project root',
                  )
                : t(
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
