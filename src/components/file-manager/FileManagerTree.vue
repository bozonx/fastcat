<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, inject, onMounted, onUnmounted } from 'vue';
import type { ComputedRef } from 'vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_ITEMS_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import type { getBdPayload } from '~/types/bloggerdog';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import {
  useClipboardPaths,
  useClipboardCopyPaths,
} from '~/composables/file-manager/useClipboardIndicator';
import { useAppClipboard } from '~/composables/useAppClipboard';
import FileManagerTreeRow from '~/components/file-manager/FileManagerTreeRow.vue';
import {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  TIMELINE_EXTENSIONS,
} from '~/utils/media-types';
import type { FileCompatibilityStatus } from '~/composables/file-manager/useFileManagerCompatibility';
import { useFileContextMenu } from '~/composables/file-manager/useFileContextMenu';
import { isRemoteFsEntry, type RemoteFsEntry } from '~/utils/remote-vfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { isGeneratingProxyInDirectory, folderHasVideos } from '~/utils/fs-entry-utils';
import {
  getDropTargetEntryPath,
  isFileManagerDropCancellationTarget,
  isCrossFileManagerDrag,
  isCancellationZone,
  resolveFileManagerDragOperation,
  resolveFileManagerDropOperation,
  shouldCancelFileManagerDrop,
} from '~/composables/file-manager/dragOperation';
import {
  resetFileManagerDragCursor,
  syncFileManagerDragCursor,
} from '~/composables/file-manager/dragCursor';
import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
const log = createDevLogger('FileManagerTree');

interface Props {
  editingEntryPath?: string | null;
  entries: FsEntry[];
  depth: number;
  foldersOnly?: boolean;
  isFilesPage?: boolean;
  instanceId?: string;
  isExternal?: boolean;
  vfs?: IFileSystemAdapter;
}

interface TreeContext {
  getFileIcon: (entry: FsEntry) => string;
  selectedPath: ComputedRef<string | null>;
  getEntryMeta: (entry: FsEntry) => {
    hasProxy: boolean;
    generatingProxy: boolean;
    proxyProgress?: number;
    isUsedInTimeline?: boolean;
  };
  getFileCompatibilityStatus?: (entry: FsEntry) => FileCompatibilityStatus;
}

const props = defineProps<Props>();

const clipboardPaths = useClipboardPaths();
const clipboardCopyPaths = useClipboardCopyPaths();

const ctx = inject<TreeContext>('fileManagerTreeCtx', {
  getFileIcon: () => 'i-heroicons-document',
  selectedPath: computed(() => null) as import('vue').ComputedRef<string | null>,
  getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
  getFileCompatibilityStatus: () => 'ok',
});

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (e: 'commitRename', entry: FsEntry, newName: string): void;
  (e: 'stopRename'): void;
  (e: 'select', entry: FsEntry, event?: MouseEvent): void;
  (e: 'focus', entry: FsEntry, event?: FocusEvent): void;
  (
    e: 'action',
    action:
      | 'createFolder'
      | 'createTimeline'
      | 'rename'
      | 'delete'
      | 'createProxy'
      | 'cancelProxy'
      | 'deleteProxy'
      | 'upload'
      | 'createProxyForFolder'
      | 'cancelProxyForFolder'
      | 'createOtioVersion'
      | 'createMarkdown'
      | 'convertFile'
      | 'openAsPanelCut'
      | 'openAsPanelSound'
      | 'openAsProjectTab'
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
    e: 'requestMove',
    params: {
      sourcePath: string;
      targetDirPath: string;
    },
  ): void;
  (
    e: 'requestCopy',
    params: {
      sourcePath: string;
      targetDirPath: string;
    },
  ): void;
  (
    e: 'requestUpload',
    params: {
      files: File[];
      targetDirPath: string;
    },
  ): void;
  (
    e: 'requestDownload',
    params: {
      entry: RemoteFsEntry;
      targetDirPath: string;
    },
  ): void;
}>();

const { setDraggedFile, clearDraggedFile } = useDraggedFile();
const proxyStore = useProxyStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUiStore();
const appClipboard = useAppClipboard();

const isDragOver = ref<string | null>(null);
const dragOperation = ref<'copy' | 'move' | 'cancel' | null>(null);

function isDotEntry(entry: FsEntry): boolean {
  return entry.name.startsWith('.');
}

function isSelected(entry: FsEntry): boolean {
  if (props.isFilesPage) {
    if (!ctx.selectedPath.value) return false;
    if (!entry.path) return false;
    return ctx.selectedPath.value === entry.path;
  } else {
    const selected = selectionStore.selectedEntity;
    if (!selected || selected.source !== 'fileManager') return false;
    if (selected.kind === 'multiple') return false;
    return selected.path === entry.path;
  }
}

function isWorkspaceCommonRoot(entry: FsEntry): boolean {
  return entry.kind === 'directory' && isWorkspaceCommonPath(entry.path);
}

function getEntryMeta(entry: FsEntry) {
  return ctx.getEntryMeta(entry);
}

function getEntryIconClass(entry: FsEntry): string {
  if (isDotEntry(entry)) return 'opacity-30';
  if (isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies)) return 'text-amber-400/90';
  if (isWorkspaceCommonRoot(entry)) return 'text-violet-400';
  if (entry.kind === 'directory') return 'text-ui-text-muted/80';

  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'text-violet-400/90';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'text-emerald-400/90';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'text-sky-400/90';
  if (TIMELINE_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext))
    return 'text-amber-400/90';
  return 'text-ui-text-muted';
}

interface EntryViewModel {
  selected: boolean;
  isDot: boolean;
  isCommonRoot: boolean;
  isCut: boolean;
  isCopy: boolean;
  iconClass: string;
  nameClass: string;
  meta: ReturnType<typeof ctx.getEntryMeta>;
  showChevron: boolean;
}

function getEntryViewModel(entry: FsEntry): EntryViewModel {
  const meta = getEntryMeta(entry);
  const selected = isSelected(entry);
  const isDot = isDotEntry(entry);
  const isCommonRoot = isWorkspaceCommonRoot(entry);
  const isCut = entry.path ? clipboardPaths.value.has(entry.path) : false;
  const isCopy = entry.path ? clipboardCopyPaths.value.has(entry.path) : false;
  const iconBase = getEntryIconClass(entry);
  const generatingDir = isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies);

  const iconClass = [
    iconBase,
    meta.hasProxy ? 'text-(--color-success)!' : '',
    isCut ? 'opacity-40' : '',
    isCopy ? 'opacity-75' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const compatibilityStatus = ctx.getFileCompatibilityStatus?.(entry) ?? 'ok';

  const nameClass = [
    selected
      ? 'font-medium text-ui-text group-hover:text-ui-text'
      : 'text-ui-text group-hover:text-ui-text',
    isCommonRoot ? 'text-violet-300 group-hover:text-violet-200' : '',
    isDot ? 'opacity-30' : '',
    meta.hasProxy && !meta.generatingProxy ? 'text-(--color-success)!' : '',
    meta.generatingProxy || generatingDir ? 'text-amber-400!' : '',
    isCut ? 'opacity-40 line-through decoration-dotted' : '',
    isCopy ? 'text-primary-300!' : '',
    compatibilityStatus !== 'ok' && compatibilityStatus !== 'checking' ? 'text-red-400!' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const hasVisibleChildren =
    entry.children !== undefined
      ? props.foldersOnly
        ? entry.children.some((child) => child.kind === 'directory')
        : entry.children.length > 0
      : props.foldersOnly
        ? entry.hasDirectories !== false
        : entry.hasChildren !== false;
  const showChevron = entry.kind === 'directory' && hasVisibleChildren;

  return { selected, isDot, isCommonRoot, isCut, isCopy, iconClass, nameClass, meta, showChevron };
}

function onEntryClick(event: MouseEvent, entry: FsEntry) {
  emit('select', entry, event);
}

function onEntryFocus(entry: FsEntry, event?: FocusEvent) {
  emit('focus', entry, event);
}

function onEntryEnter(event: KeyboardEvent, entry: FsEntry) {
  if (entry.kind === 'directory') {
    emit('toggle', entry);
    emit('select', entry); // No mouse event for keyboard
  } else {
    emit('select', entry);
  }
}

function onRenameClick(entry: FsEntry) {
  if (entry.path === WORKSPACE_COMMON_PATH_PREFIX) return;
  if (isBloggerDogVirtualFolder(entry) || isBloggerDogProject(entry)) return;
  emit('action', 'rename', entry);
}

function onCaretClick(e: MouseEvent, entry: FsEntry) {
  e.stopPropagation();
  if (entry.kind !== 'directory') return;
  emit('toggle', entry);
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (!entry.path) return;

  const entriesToMove: FsEntry[] = [entry];

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  const operation = isLayer1Active(e, workspaceStore.userSettings) ? 'copy' : 'move';
  dragOperation.value = operation;
  uiStore.isFileManagerDragging = true;
  appClipboard.setDragSourceFileManagerInstanceId(props.instanceId ?? null);
  appClipboard.setDragSourceVfs(props.vfs ?? null);
  appClipboard.setCurrentDragOperation(operation);
  appClipboard.setDragTargetFileManagerInstanceId(props.instanceId ?? null);
  syncFileManagerDragCursor({ isDragging: true, operation });
  const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
  appClipboard.setDraggedItems(movePayload);
  const serializedPayload = JSON.stringify(movePayload);
  e.dataTransfer?.setData(FILE_MANAGER_ITEMS_DRAG_TYPE, serializedPayload);
  e.dataTransfer?.setData(
    operation === 'copy' ? FILE_MANAGER_COPY_DRAG_TYPE : FILE_MANAGER_MOVE_DRAG_TYPE,
    serializedPayload,
  );

  // Mark this as an internal drag so the global drop overlay is not shown
  e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

  if (entry.kind !== 'file') return;

  const isTimeline = entry.name.toLowerCase().endsWith('.otio');
  const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
  const data: DraggedFileData = {
    name: entry.name,
    kind,
    path: entry.path,
    operation,
    count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
    items: movePayload,
    isExternal: props.isExternal,
  };
  setDraggedFile(data);
  e.dataTransfer?.setData('application/json', JSON.stringify(data));
}

function onDragEnd() {
  clearDraggedFile();
  isDragOver.value = null;
  dragOperation.value = null;
  uiStore.isFileManagerDragging = false;
  appClipboard.setCurrentDragOperation(null);
  appClipboard.setDragSourceFileManagerInstanceId(null);
  appClipboard.setDragTargetFileManagerInstanceId(null);
  appClipboard.setDragSourceVfs(null);
  appClipboard.clearDraggedItems();
  resetFileManagerDragCursor();
}

function isSameFileSystemDrag(): boolean | null {
  return appClipboard.dragSourceVfs && props.vfs ? appClipboard.dragSourceVfs === props.vfs : null;
}

function resolveDragOperation(e: DragEvent): 'copy' | 'move' {
  return resolveFileManagerDragOperation({
    dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
    isLayer1Active: isLayer1Active(e, workspaceStore.userSettings),
    isSameFileSystem: isSameFileSystemDrag(),
    targetFileManagerInstanceId: props.instanceId ?? null,
  });
}

function resolveDropOperation(
  e: DragEvent,
  fallbackRawOperation: 'copy' | 'move' | null,
): 'copy' | 'move' {
  return resolveFileManagerDropOperation({
    dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
    isLayer1Active: isLayer1Active(e, workspaceStore.userSettings),
    isSameFileSystem: isSameFileSystemDrag(),
    targetFileManagerInstanceId: props.instanceId ?? null,
    currentDragOperation: appClipboard.currentDragOperation,
    fallbackRawOperation,
  });
}

function syncDragOperationFromKeyboard(event: KeyboardEvent) {
  if (!uiStore.isFileManagerDragging) return;
  if (appClipboard.currentDragOperation === 'cancel') return;
  if (appClipboard.dragTargetFileManagerInstanceId !== (props.instanceId ?? null)) return;

  const operation = resolveFileManagerDragOperation({
    dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
    isLayer1Active: isLayer1Active(event, workspaceStore.userSettings),
    isSameFileSystem: isSameFileSystemDrag(),
    targetFileManagerInstanceId: props.instanceId ?? null,
  });

  dragOperation.value = operation;
  appClipboard.setCurrentDragOperation(operation);
  syncFileManagerDragCursor({ isDragging: true, operation });
}

onMounted(() => {
  window.addEventListener('keydown', syncDragOperationFromKeyboard, { capture: true });
  window.addEventListener('keyup', syncDragOperationFromKeyboard, { capture: true });
});

onUnmounted(() => {
  window.removeEventListener('keydown', syncDragOperationFromKeyboard, { capture: true });
  window.removeEventListener('keyup', syncDragOperationFromKeyboard, { capture: true });
});

function onDragOverDir(e: DragEvent, entry: FsEntry) {
  const isCancel = isCancellationZone({
    items: appClipboard.draggedItems,
    targetEntryPath: entry.path,
    targetDirPath: entry.path,
  });

  if (entry.kind !== 'directory' && !isCancel) return;

  const types = e.dataTransfer?.types;
  if (!types) return;
  const dragTypes = Array.from(types);

  if (
    dragTypes.includes(FILE_MANAGER_ITEMS_DRAG_TYPE) ||
    dragTypes.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
    dragTypes.includes(FILE_MANAGER_COPY_DRAG_TYPE)
  ) {
    // Basic restriction: internal dragging of files within Bloggerdog is not supported.
    const isSourceBd = appClipboard.dragSourceVfs?.id === 'bloggerdog';
    const isTargetBd = props.vfs?.id === 'bloggerdog';
    if (isSourceBd && isTargetBd) {
      const draggedItems = appClipboard.draggedItems;
      const hasFiles = draggedItems.some((item) => item.kind === 'file');
      if (hasFiles) {
        return;
      }
    }

    isDragOver.value = entry.path || null;
    if (isCancel) {
      dragOperation.value = 'cancel';
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(props.instanceId ?? null);
      e.dataTransfer.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
      return;
    }
    dragOperation.value = resolveDragOperation(e);
    appClipboard.setCurrentDragOperation(dragOperation.value);
    appClipboard.setDragTargetFileManagerInstanceId(props.instanceId ?? null);
    e.dataTransfer.dropEffect = dragOperation.value === 'copy' ? 'copy' : 'move';
    syncFileManagerDragCursor({ isDragging: true, operation: dragOperation.value });
    return;
  }

  if (dragTypes.includes(REMOTE_FILE_DRAG_TYPE)) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'copy';
    syncFileManagerDragCursor({ isDragging: true, operation: 'copy' });
    return;
  }

  // External files import
  if (dragTypes.includes('Files')) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'copy';
    syncFileManagerDragCursor({ isDragging: true, operation: 'copy' });
  }
}

function onDragLeaveDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;
  if (isDragOver.value !== entry.path) return;

  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isDragOver.value = null;
    dragOperation.value = null;
    appClipboard.setCurrentDragOperation(null);
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();
  }
}

async function onDropDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  e.stopPropagation();

  if (
    isFileManagerDropCancellationTarget({
      event: e,
      targetEntryPath: getDropTargetEntryPath(e) ?? entry.path,
      targetDirPath: entry.path,
    })
  ) {
    onDragEnd();
    return;
  }

  const operation = dragOperation.value;
  isDragOver.value = null;
  dragOperation.value = null;
  appClipboard.setCurrentDragOperation(null);
  appClipboard.setDragTargetFileManagerInstanceId(null);
  resetFileManagerDragCursor();

  const itemsRaw = e.dataTransfer?.getData(FILE_MANAGER_ITEMS_DRAG_TYPE);
  const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
  const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  const internalRaw = itemsRaw || copyRaw || moveRaw;
  if (internalRaw) {
    const isCrossManagerDrag = isCrossFileManagerDrag({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      targetFileManagerInstanceId: props.instanceId ?? null,
    });
    const fallbackOp = operation === 'cancel' ? null : operation;
    const shouldCopy =
      resolveDropOperation(e, fallbackOp ?? (copyRaw ? 'copy' : moveRaw ? 'move' : null)) ===
      'copy';
    let parsed: unknown;
    try {
      parsed = JSON.parse(internalRaw);
    } catch {
      return;
    }

    const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];
    if (
      shouldCancelFileManagerDrop({
        items: itemsToMove,
        targetEntryPath: getDropTargetEntryPath(e) ?? entry.path,
      })
    ) {
      return;
    }

    if (isCrossManagerDrag && appClipboard.dragSourceVfs && props.vfs) {
      try {
        for (const item of itemsToMove) {
          const sourcePath = typeof item?.path === 'string' ? item.path : '';
          if (!sourcePath || sourcePath === entry.path) continue;

          const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
          if (shouldCopy) {
            await crossVfsCopy({
              sourceVfs: appClipboard.dragSourceVfs,
              targetVfs: props.vfs,
              sourcePath,
              sourceKind,
              targetDirPath: entry.path,
            });
          } else {
            await crossVfsMove({
              sourceVfs: appClipboard.dragSourceVfs,
              targetVfs: props.vfs,
              sourcePath,
              sourceKind,
              targetDirPath: entry.path,
            });
          }
        }
        uiStore.notifyFileManagerUpdate();
      } catch (err) {
        log.error('Cross-VFS operation failed:', err);
      }
    } else {
      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath || sourcePath === entry.path) continue;

        if (shouldCopy) {
          emit('requestCopy', {
            sourcePath,
            targetDirPath: entry.path,
          });
        } else {
          emit('requestMove', {
            sourcePath,
            targetDirPath: entry.path,
          });
        }
      }
    }
    return;
  }

  const remoteRaw = e.dataTransfer?.getData(REMOTE_FILE_DRAG_TYPE);
  if (remoteRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(remoteRaw);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const remoteEntry = parsed as RemoteFsEntry;
    if (!isRemoteFsEntry(remoteEntry) || remoteEntry.kind !== 'file') return;

    emit('requestDownload', {
      entry: remoteEntry,
      targetDirPath: entry.path,
    });
    return;
  }

  const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  const files =
    droppedFiles.length > 0
      ? droppedFiles
      : Array.from(e.dataTransfer?.items ?? [])
          .map((item) => item.getAsFile())
          .filter((file): file is File => file instanceof File);

  if (files.length === 0) return;

  emit('requestUpload', {
    files,
    targetDirPath: entry.path,
  });
}

function getBdType(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.type;
}

const isBloggerDogVirtualFolder = (entry: FsEntry) => {
  return getBdType(entry) === 'virtual-folder';
};

const isBloggerDogProject = (entry: FsEntry) => {
  if (entry.source !== 'remote') return false;
  return getBdType(entry) === 'project';
};

const isBloggerDogGroup = (entry: FsEntry) => {
  if (entry.source !== 'remote') return false;
  if (entry.kind !== 'directory') return false;
  return getBdType(entry) === 'collection';
};

const isBloggerDogContentItem = (entry: FsEntry) => {
  if (entry.source !== 'remote') return false;
  return getBdType(entry) === 'content-item';
};

const isBloggerDogMediaFile = (entry: FsEntry) => {
  if (entry.source !== 'remote') return false;
  const payload = entry.adapterPayload as { type?: string; mediaId?: string };
  return payload?.type === 'media' && !!payload?.mediaId;
};

const isBloggerDogTextWrapper = (entry: FsEntry) => {
  if (entry.source !== 'remote') return false;
  const payload = entry.adapterPayload as { type?: string; mediaId?: string };
  return payload?.type === 'media' && !payload?.mediaId;
};

const clipboardStore = useAppClipboard();

const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory: (entry) =>
      isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies),
    folderHasVideos,
    isOpenableMediaFile: () => true,
    isConvertibleMediaFile: () => true,
    isTranscribableMediaFile: () => true,
    isVideo: () => false,
    getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
    getSelectedEntries: () => [],
    isFilesPage: props.isFilesPage,
    instanceId: props.instanceId,
    isExternal: props.isExternal,
    isBloggerDogProject,
    isBloggerDogGroup,
    isBloggerDogContentItem,
    isBloggerDogVirtualFolder,
    isBloggerDogMedia: isBloggerDogMediaFile,
    isBloggerDogTextWrapper,
    get hasClipboardItems() {
      return clipboardStore.hasFileManagerPayload;
    },
  },
  (action, entry) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit('action', action as any, entry as import('~/types/fs').FsEntry);
  },
);
</script>

<template>
  <ul class="select-none min-w-full w-max">
    <template v-for="entry in entries" :key="entry.path || entry.name">
      <li v-if="!foldersOnly || entry.kind === 'directory'">
        <!-- Row -->
        <UContextMenu :items="getContextMenuItems(entry)">
          <FileManagerTreeRow
            :entry="entry"
            :depth="depth"
            :is-drag-over="isDragOver === entry.path"
            :drag-operation="dragOperation"
            :editing-entry-path="editingEntryPath"
            :existing-names="(entries || []).map((e) => e.name)"
            :file-icon="ctx.getFileIcon(entry)"
            v-bind="getEntryViewModel(entry)"
            :menu-items="!isFilesPage ? getContextMenuItems(entry) : []"
            @click="onEntryClick($event, entry)"
            @focus="onEntryFocus(entry)"
            @dblclick="onRenameClick(entry)"
            @keydown-enter="onEntryEnter($event, entry)"
            @keydown-space="onEntryEnter($event, entry)"
            @dragstart="onDragStart($event, entry)"
            @dragend="onDragEnd()"
            @dragover="onDragOverDir($event, entry)"
            @dragleave="onDragLeaveDir($event, entry)"
            @drop="onDropDir($event, entry)"
            @caret-click="onCaretClick($event, entry)"
            @commit-rename="(name) => emit('commitRename', entry, name)"
            @stop-rename="emit('stopRename')"
          />
        </UContextMenu>

        <!-- Children -->
        <template v-if="entry.kind === 'directory' && entry.expanded && entry.children">
          <FileManagerTree
            :editing-entry-path="editingEntryPath"
            :entries="entry.children"
            :depth="depth + 1"
            :folders-only="foldersOnly"
            :instance-id="instanceId"
            :is-files-page="isFilesPage"
            :is-external="isExternal"
            :vfs="vfs"
            @commit-rename="(entry, name) => emit('commitRename', entry, name)"
            @stop-rename="emit('stopRename')"
            @toggle="emit('toggle', $event)"
            @select="(entry, event) => emit('select', entry, event)"
            @focus="(entry, event) => emit('focus', entry, event)"
            @action="(action, childEntry) => emit('action', action, childEntry)"
            @request-move="emit('requestMove', $event)"
            @request-copy="emit('requestCopy', $event)"
            @request-upload="emit('requestUpload', $event)"
            @request-download="emit('requestDownload', $event)"
          />
        </template>
      </li>
    </template>
  </ul>
</template>
