<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, inject } from 'vue';
import type { ComputedRef } from 'vue';
import { useDraggedFile } from '~/composables/useDraggedFile';
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
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { isGeneratingProxyInDirectory, folderHasVideos } from '~/utils/fs';
import {
  getDropTargetEntryPathFromEl,
  isCrossFileManagerDrag,
  isCancellationZone,
  resolveFileManagerDragOperation,
  resolveFileManagerDropOperation,
  shouldCancelFileManagerDrop,
} from '~/composables/file-manager/dragOperation';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext, DndPayload, DndPointer } from '~/composables/dnd/dndTypes';
import type { FileManagerDndPayloadData } from '~/composables/file-manager/useFileBrowserDragAndDrop';
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

function isLayer1FromPointer(p: DndPointer): boolean {
  return isLayer1Active(
    {
      shiftKey: p.shiftKey,
      ctrlKey: p.ctrlKey,
      altKey: p.altKey,
      metaKey: p.metaKey,
    } as unknown as MouseEvent,
    workspaceStore.userSettings,
  );
}

function isSameFileSystemDrag(): boolean | null {
  return appClipboard.dragSourceVfs && props.vfs ? appClipboard.dragSourceVfs === props.vfs : null;
}

// --- source: arm a pointer drag from a tree row ----------------------------
function onTreePointerDown(e: PointerEvent, entry: FsEntry) {
  if (!entry.path) return;

  const operation: 'copy' | 'move' = isLayer1Active(e, workspaceStore.userSettings)
    ? 'copy'
    : 'move';
  const movePayload = [{ name: entry.name, kind: entry.kind, path: entry.path }];

  dragOperation.value = operation;
  uiStore.isFileManagerDragging = true;
  appClipboard.setDragSourceFileManagerInstanceId(props.instanceId ?? null);
  appClipboard.setDragSourceVfs(props.vfs ?? null);
  appClipboard.setCurrentDragOperation(operation);
  appClipboard.setDragTargetFileManagerInstanceId(props.instanceId ?? null);
  appClipboard.setDraggedItems(movePayload);

  if (entry.kind === 'file') {
    const isTimeline = entry.name.toLowerCase().endsWith('.otio');
    setDraggedFile({
      name: entry.name,
      kind: isTimeline ? 'timeline' : 'file',
      path: entry.path,
      operation,
      items: movePayload,
      isExternal: props.isExternal,
    });
  }

  const payload: DndPayload<FileManagerDndPayloadData> = {
    source: 'file-manager',
    data: { items: movePayload, sourceInstanceId: props.instanceId ?? null, primaryEntry: entry },
    preview: { label: entry.name, count: 1 },
  };
  armPointerDnd(e, { payload, onEnd: () => clearTreeDragState() });
}

function clearTreeDragState() {
  clearDraggedFile();
  isDragOver.value = null;
  dragOperation.value = null;
  uiStore.isFileManagerDragging = false;
  appClipboard.setCurrentDragOperation(null);
  appClipboard.setDragSourceFileManagerInstanceId(null);
  appClipboard.setDragTargetFileManagerInstanceId(null);
  appClipboard.setDragSourceVfs(null);
  appClipboard.clearDraggedItems();
}

// --- drop zone (root instance only; covers nested levels via hit-test) -----
function findEntryInTree(entries: FsEntry[], path: string): FsEntry | null {
  for (const e of entries) {
    if (e.path === path) return e;
    if (e.kind === 'directory' && e.children?.length) {
      const found = findEntryInTree(e.children, path);
      if (found) return found;
    }
  }
  return null;
}

function resolveTreeDropDir(targetEl: Element | null): FsEntry | null {
  const path = getDropTargetEntryPathFromEl(targetEl);
  const entry = path ? findEntryInTree(props.entries, path) : null;
  return entry?.kind === 'directory' ? entry : null;
}

function isBloggerDogInternalFileDrag(items: Array<{ kind?: unknown }>): boolean {
  return (
    props.vfs?.id === 'bloggerdog' &&
    appClipboard.dragSourceVfs?.id === 'bloggerdog' &&
    items.some((i) => i.kind === 'file')
  );
}

function onTreeZoneOver(ctx: DndDragContext) {
  const data = ctx.payload.data as FileManagerDndPayloadData;
  const dir = resolveTreeDropDir(ctx.targetEl);
  if (!dir) {
    isDragOver.value = null;
    dragOperation.value = null;
    ctx.setOperation('none');
    return;
  }
  if (isBloggerDogInternalFileDrag(data.items)) {
    isDragOver.value = null;
    dragOperation.value = 'cancel';
    ctx.setOperation('cancel');
    return;
  }
  isDragOver.value = dir.path ?? null;
  appClipboard.setDragTargetFileManagerInstanceId(props.instanceId ?? null);
  if (
    isCancellationZone({ items: data.items, targetEntryPath: dir.path, targetDirPath: dir.path })
  ) {
    dragOperation.value = 'cancel';
    appClipboard.setCurrentDragOperation('cancel');
    ctx.setOperation('cancel');
    return;
  }
  const op = resolveFileManagerDragOperation({
    dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
    isLayer1Active: isLayer1FromPointer(ctx.pointer),
    isSameFileSystem: isSameFileSystemDrag(),
    targetFileManagerInstanceId: props.instanceId ?? null,
  });
  dragOperation.value = op;
  appClipboard.setCurrentDragOperation(op);
  ctx.setOperation(op);
}

function onTreeZoneLeave() {
  isDragOver.value = null;
  dragOperation.value = null;
  appClipboard.setDragTargetFileManagerInstanceId(null);
}

async function onTreeZoneDrop(ctx: DndDragContext) {
  const data = ctx.payload.data as FileManagerDndPayloadData;
  const items = data.items;
  const dir = resolveTreeDropDir(ctx.targetEl);

  isDragOver.value = null;
  dragOperation.value = null;
  appClipboard.setCurrentDragOperation(null);
  appClipboard.setDragTargetFileManagerInstanceId(null);

  if (!dir || items.length === 0) return;
  if (shouldCancelFileManagerDrop({ items, targetEntryPath: dir.path })) return;
  if (isCancellationZone({ items, targetEntryPath: dir.path, targetDirPath: dir.path })) return;
  if (isBloggerDogInternalFileDrag(items)) return;

  const isCrossManagerDrag = isCrossFileManagerDrag({
    dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
    targetFileManagerInstanceId: props.instanceId ?? null,
  });
  const shouldCopy =
    resolveFileManagerDropOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1FromPointer(ctx.pointer),
      isSameFileSystem: isSameFileSystemDrag(),
      targetFileManagerInstanceId: props.instanceId ?? null,
      currentDragOperation: appClipboard.currentDragOperation,
      fallbackRawOperation: null,
    }) === 'copy';

  if (isCrossManagerDrag && appClipboard.dragSourceVfs && props.vfs) {
    try {
      for (const item of items) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath || sourcePath === dir.path) continue;
        const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
        if (shouldCopy) {
          await crossVfsCopy({
            sourceVfs: appClipboard.dragSourceVfs,
            targetVfs: props.vfs,
            sourcePath,
            sourceKind,
            targetDirPath: dir.path,
          });
        } else {
          await crossVfsMove({
            sourceVfs: appClipboard.dragSourceVfs,
            targetVfs: props.vfs,
            sourcePath,
            sourceKind,
            targetDirPath: dir.path,
          });
        }
      }
      uiStore.notifyFileManagerUpdate();
    } catch (err) {
      log.error('Cross-VFS operation failed:', err);
    }
  } else {
    for (const item of items) {
      const sourcePath = typeof item?.path === 'string' ? item.path : '';
      if (!sourcePath || sourcePath === dir.path) continue;
      if (shouldCopy) {
        emit('requestCopy', { sourcePath, targetDirPath: dir.path });
      } else {
        emit('requestMove', { sourcePath, targetDirPath: dir.path });
      }
    }
  }
}

// Only the root tree registers a drop zone; it covers all nested levels via the
// engine's hit-test (`data-entry-path` rows).
const treeDndZoneAttrs =
  props.depth === 0
    ? useDndDropZone(
        {
          canAccept: (payload: DndPayload) => payload.source === 'file-manager',
          onEnter: onTreeZoneOver,
          onOver: onTreeZoneOver,
          onLeave: onTreeZoneLeave,
          onDrop: onTreeZoneDrop,
        },
        'file-tree',
      ).zoneAttrs
    : ({} as Record<string, string>);

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
    inDevelopmentFeaturesEnabled: workspaceStore.inDevelopmentFeaturesEnabled,
    premiumFeaturesEnabled: workspaceStore.premiumFeaturesEnabled,
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
  <ul class="select-none min-w-full w-max" v-bind="treeDndZoneAttrs">
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
            @entry-pointer-down="onTreePointerDown($event, entry)"
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
