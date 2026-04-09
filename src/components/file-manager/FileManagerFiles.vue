<script setup lang="ts">
import { ref, computed, provide, watch, nextTick, inject } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useAutoScroll } from '~/composables/ui/useAutoScroll';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useMediaStore } from '~/stores/media.store';
import { BROWSER_NATIVE_IMAGE_EXTENSIONS, getMediaTypeFromFilename } from '~/utils/media-types';
import type { FileCompatibilityStatus } from '~/composables/file-manager/useFileManagerCompatibility';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusableListNavigation } from '~/composables/file-manager/useFocusableListNavigation';
import FileManagerTree from './FileManagerTree.vue';
import type { FsEntry } from '~/types/fs';
import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { useVfs } from '~/composables/useVfs';
import { useFileManagerSelection } from '~/composables/file-manager/useFileManagerSelection';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

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
  handleFiles: (
    files: FileList | File[],
    options?: {
      targetDirPath?: string;
      abortSignal?: AbortSignal;
      onProgress?: (params: {
        currentFileIndex: number;
        totalFiles: number;
        fileName: string;
      }) => void;
    },
  ) => Promise<void>;
  onCopyEntries?: (entries: FsEntry[]) => void;
  onCutEntries?: (entries: FsEntry[]) => void;
  onPasteToEntry?: (entry: FsEntry) => void;
  instanceId?: string;
  isExternal?: boolean;
  vfs?: IFileSystemAdapter;
  rootSelectionEntry?: FsEntry | null;
}>();

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
      | 'transcribe'
      | 'extractAudio'
      | 'paste'
      | 'copy'
      | 'cut'
      | 'createSubgroup'
      | 'createContentItem',
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
const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const mediaStore = useMediaStore();

watch(
  () => props.rootEntries,
  (entries) => {
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name);
      if (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image') continue;
      if (!mediaStore.mediaMetadata[entry.path] && !mediaStore.metadataLoadFailed[entry.path]) {
        void mediaStore.getOrFetchMetadataByPath(entry.path);
      }
    }
  },
  { immediate: true },
);

const scrollEl = ref<HTMLElement | null>(null);

const selectedPath = computed(() => {
  if (props.isFilesPage) {
    return fileManagerStore.selectedFolder?.path ?? projectStore.currentProjectName ?? null;
  }
  return uiStore.selectedFsEntry?.path ?? null;
});

const mediaUsageMap = computed(() => timelineMediaUsageStore.mediaPathToTimelines);

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

const { onKeyDown: onContainerKeyDown, moveSelection } = useFocusableListNavigation({
  containerRef: scrollEl,
});

watch(
  () => uiStore.fileBrowserMoveSelectionTrigger,
  (trigger) => {
    // Only handle if this is the sidebar and it's focused
    const focusId = `dynamic:file-manager:${props.instanceId || 'left'}` as PanelFocusId;
    if (
      !props.isFilesPage &&
      (focusStore.isPanelFocused(focusId) || focusStore.isPanelFocused('project'))
    ) {
      moveSelection(trigger.dir);
    }
  },
);

const {
  onDragOver: autoScrollDragOver,
  onDragLeave: autoScrollDragLeave,
  onDrop: autoScrollDrop,
} = useAutoScroll(scrollEl);

function onContainerDragOver(e: DragEvent) {
  if (!isRelevantDrag(e)) return;
  onRootDragOver(e);
  autoScrollDragOver(e);
}

function onContainerDrop(e: DragEvent) {
  autoScrollDrop();
  onRootDrop(e);
}

function onContainerDragLeave(e: DragEvent) {
  autoScrollDragLeave(e);
}

function onEntryFocus(_entry: FsEntry) {
  const focusId =
    `dynamic:file-manager:${props.instanceId || (props.isFilesPage ? 'filesBrowser' : 'left')}` as PanelFocusId;
  focusStore.setPanelFocus(focusId);
}

function onTreeContainerKeyDown(e: KeyboardEvent) {
  onContainerKeyDown(e);
}

provide('fileManagerTreeCtx', {
  getFileIcon: props.getFileIcon,
  selectedPath,
  getEntryMeta,
  getFileCompatibilityStatus,
});

function getFileCompatibilityStatus(entry: FsEntry): FileCompatibilityStatus {
  if (entry.kind !== 'file' || !entry.path) return 'ok';

  const mediaType = getMediaTypeFromFilename(entry.name);
  if (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image') return 'ok';

  const path = entry.path;

  if (mediaStore.metadataLoadFailed[path]) return 'fully_unsupported';

  const meta = mediaStore.mediaMetadata[path];
  if (!meta) return 'ok';

  if (mediaType === 'image') {
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext) && meta.image?.canDisplay === false) {
      return 'fully_unsupported';
    }
    return 'ok';
  }

  if (mediaType === 'video') {
    if (meta.video?.canDecode === false) return 'fully_unsupported';
    if (meta.audio?.canDecode === false) return 'audio_unsupported';
    return 'ok';
  }

  if (meta.audio?.canDecode === false) return 'fully_unsupported';
  return 'ok';
}

function getEntryMeta(entry: FsEntry): {
  hasProxy: boolean;
  generatingProxy: boolean;
  proxyProgress?: number;
  isUsedInTimeline?: boolean;
} {
  if (entry.kind !== 'file' || !entry.path) {
    return { hasProxy: false, generatingProxy: false };
  }

  const hasProxy = props.mediaCache?.hasProxy?.(entry.path) ?? false;
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
  await props.handleFiles(params.files, { targetDirPath: params.targetDirPath });
  uiStore.notifyFileManagerUpdate();
}

function onRequestDownload(params: { entry: RemoteFsEntry; targetDirPath: string }) {
  uiStore.pendingRemoteDownloadRequest = params;
}

const {
  isRelevantDrag,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
} = useFileDrop({
  resolveEntryByPath: async (path: string) => props.findEntryByPath(path),
  handleFiles: props.handleFiles,
  moveEntry: props.moveEntry,
  copyEntry: props.copyEntry,
  targetFileManagerInstanceId: props.instanceId ?? null,
  vfs: props.vfs ?? useVfs(),
});

const rootContextMenuItems = computed(() => {
  const rootEntry: FsEntry =
    props.rootSelectionEntry ||
    ({
      kind: 'directory',
      name: projectStore.currentProjectName || '/',
      path: '',
    } as FsEntry);

  if (props.isExternal) {
    const menu: Record<string, any>[][] = [
      [
        {
          label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
          icon: 'i-heroicons-folder-plus',
          onSelect: async () => emit('action', 'createFolder', rootEntry),
        },
        {
          label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
          icon: 'i-heroicons-document-text',
          onSelect: async () => emit('action', 'createMarkdown', rootEntry),
        },
        {
          label: t('common.paste', 'Paste'),
          icon: 'i-heroicons-clipboard',
          disabled: !clipboardStore.hasFileManagerPayload,
          onSelect: async () => emit('action', 'paste', rootEntry),
        },
      ],
    ];

    return menu;
  }

  if (!projectStore.currentProjectName) return [];

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
  const rootEntry =
    props.rootSelectionEntry ??
    (projectStore.currentProjectName
      ? ({
          kind: 'directory',
          name: projectStore.currentProjectName,
          path: '',
        } as FsEntry)
      : null);

  if (!rootEntry) return;
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
  instanceId: props.instanceId,
  isExternal: props.isExternal,
});

async function onEntrySelect(entry: FsEntry, event?: MouseEvent) {
  if (event && !props.isFilesPage) {
    handleSelectionClick(event, entry);
    focusStore.setTempFocus('left');
    if (!props.isExternal && entry.kind === 'file' && entry.path?.toLowerCase().endsWith('.otio')) {
      await loadTimeline(entry.path);
    }
    return;
  }

  selectSingle(entry);

  focusStore.setTempFocus('left');
  if (!props.isExternal && entry.kind === 'file' && entry.path?.toLowerCase().endsWith('.otio')) {
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
    @drop.prevent.stop="onContainerDrop"
    @keydown="onTreeContainerKeyDown"
  >
    <UContextMenu :items="rootContextMenuItems">
      <div class="min-w-full w-max min-h-full flex flex-col" @pointerdown.self="selectProjectRoot">
        <div
          v-if="rootEntries.length === 0"
          class="flex flex-col items-center justify-center flex-1 w-full gap-3 text-ui-text-disabled px-4 text-center min-h-50 relative"
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
        <FileManagerTree
          v-else
          :editing-entry-path="editingEntryPath"
          :entries="rootEntries"
          :depth="0"
          :folders-only="foldersOnly"
          :instance-id="instanceId"
          :is-external="isExternal"
          :is-files-page="isFilesPage"
          :vfs="vfs"
          @commit-rename="(entry, name) => emit('commitRename', entry, name)"
          @stop-rename="emit('stopRename')"
          @toggle="emit('toggle', $event)"
          @select="onEntrySelect"
          @focus="onEntryFocus"
          @action="(action, entry) => emit('action', action as any, entry)"
          @request-move="onRequestMove"
          @request-copy="onRequestCopy"
          @request-upload="onRequestUpload"
          @request-download="onRequestDownload"
        />

        <div class="file-manager-root-spacer relative" @pointerdown.self="selectProjectRoot" />
      </div>
    </UContextMenu>
  </div>
</template>

<style scoped>
.file-manager-root-spacer {
  width: 100%;
  min-width: 100%;
  height: 6rem;
  flex-shrink: 0;
}
</style>
