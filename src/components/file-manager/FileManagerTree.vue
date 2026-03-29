<script setup lang="ts">
import { ref, inject, watch } from 'vue';
import type { ComputedRef } from 'vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import { useProxyStore } from '~/stores/proxy.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import {
  useClipboardPaths,
  useClipboardCopyPaths,
} from '~/composables/fileManager/useClipboardIndicator';
import { useAppClipboard } from '~/composables/useAppClipboard';
import FileManagerTreeRow from '~/components/file-manager/FileManagerTreeRow.vue';
import {
  getMediaTypeFromFilename,
  isOpenableProjectFileName,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  TIMELINE_EXTENSIONS,
} from '~/utils/media-types';
import { useFileContextMenu } from '~/composables/fileManager/useFileContextMenu';
import { isRemoteFsEntry, type RemoteFsEntry } from '~/utils/remote-vfs';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { isGeneratingProxyInDirectory, folderHasVideos } from '~/utils/fsEntryUtils';

interface Props {
  editingEntryPath?: string | null;
  entries: FsEntry[];
  depth: number;
  foldersOnly?: boolean;
  isFilesPage?: boolean;
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
}

const props = defineProps<Props>();

const clipboardPaths = useClipboardPaths();
const clipboardCopyPaths = useClipboardCopyPaths();

const ctx = inject<TreeContext>('fileManagerTreeCtx', {
  getFileIcon: () => 'i-heroicons-document',
  selectedPath: ref(null) as any,
  getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
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
      | 'uploadRemote'
      | 'transcribe'
      | 'extractAudio'
      | 'paste',
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

const isDragOver = ref<string | null>(null);
const dragOperation = ref<'copy' | 'move' | null>(null);

watch(
  () => uiStore.fileTreeSelectAllTrigger,
  () => {
    if (props.depth !== 0) return;
    const selected = selectionStore.selectedEntity;

    let anchorEntry: FsEntry | null = null;

    if (selected && selected.source === 'fileManager') {
      anchorEntry =
        selected.kind === 'multiple'
          ? (selected.entries[selected.entries.length - 1] as FsEntry)
          : (selected.entry as FsEntry);
    }

    // If nothing is selected through selectionStore (e.g., just clicked a folder
    // and it became active in uiStore), use uiStore.selectedFsEntry
    if (!anchorEntry && uiStore.selectedFsEntry) {
      anchorEntry = uiStore.selectedFsEntry as FsEntry;
    }

    if (!anchorEntry) return;

    const siblingEntries = getSiblingEntries(anchorEntry);

    let selectedPaths: string[] = [];
    if (selected && selected.source === 'fileManager') {
      selectedPaths =
        selected.kind === 'multiple'
          ? selected.entries.map((entry) => entry.path)
          : [selected.entry.path];
    } else if (uiStore.selectedFsEntry?.path) {
      selectedPaths = [uiStore.selectedFsEntry.path];
    }

    const visiblePaths = siblingEntries.map((entry) => entry.path);
    const isAllSelected =
      siblingEntries.length > 0 &&
      selectedPaths.length === visiblePaths.length &&
      visiblePaths.every((path) => selectedPaths.includes(path));

    if (isAllSelected) {
      selectionStore.clearSelection();
      return;
    }
    selectionStore.selectFsEntries(siblingEntries);
  },
);

function getVisibleEntries(entriesList: FsEntry[]): FsEntry[] {
  const list: FsEntry[] = [];
  for (const e of entriesList) {
    list.push(e);
    if (e.kind === 'directory' && e.expanded && e.children) {
      list.push(...getVisibleEntries(e.children));
    }
  }
  return list;
}

function getSiblingEntries(entry: FsEntry): FsEntry[] {
  const parentPath = entry.parentPath ?? entry.path?.split('/').slice(0, -1).join('/') ?? '';
  const visibleEntries = getVisibleEntries(props.entries);

  return visibleEntries.filter((candidate) => {
    const candidateParentPath =
      candidate.parentPath ?? candidate.path?.split('/').slice(0, -1).join('/') ?? '';
    return candidateParentPath === parentPath;
  });
}

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
    if (selected.kind === 'multiple') {
      return selected.entries.some((e) => e.path === entry.path);
    }
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
  ]
    .filter(Boolean)
    .join(' ');

  const showChevron =
    entry.kind === 'directory' &&
    (props.foldersOnly ? entry.hasDirectories !== false : entry.hasChildren !== false) &&
    (!props.foldersOnly || !entry.children || entry.children.some((c) => c.kind === 'directory'));

  return { selected, isDot, isCommonRoot, isCut, isCopy, iconClass, nameClass, meta, showChevron };
}

function isVideo(entry: FsEntry): boolean {
  if (entry.kind !== 'file') return false;
  return getMediaTypeFromFilename(entry.name) === 'video';
}

function isOpenableMediaFile(entry: FsEntry): boolean {
  if (entry.kind !== 'file') return false;
  return isOpenableProjectFileName(entry.name);
}

function isConvertibleMediaFile(entry: FsEntry): boolean {
  if (entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(entry.name);
  return type === 'video' || type === 'audio' || type === 'image';
}

function isTranscribableMediaFile(entry: FsEntry): boolean {
  if (entry.kind !== 'file' || entry.source === 'remote') return false;
  const type = getMediaTypeFromFilename(entry.name);
  return type === 'audio' || type === 'video';
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
  emit('action', 'rename', entry);
}

function onCaretClick(e: MouseEvent, entry: FsEntry) {
  e.stopPropagation();
  if (entry.kind !== 'directory') return;
  emit('toggle', entry);
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (!entry.path) return;

  const selected = selectionStore.selectedEntity;

  let entriesToMove: FsEntry[] = [entry];

  // If dragging an already selected item, move the whole selection
  if (selected?.source === 'fileManager') {
    if (selected.kind === 'multiple') {
      const isSelected = selected.entries.some((s) => s.path === entry.path);
      if (isSelected) {
        entriesToMove = selected.entries;
      }
    }
  }

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  const operation = isLayer1Active(e, workspaceStore.userSettings) ? 'copy' : 'move';
  dragOperation.value = operation;
  const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
  e.dataTransfer?.setData(
    operation === 'copy' ? FILE_MANAGER_COPY_DRAG_TYPE : FILE_MANAGER_MOVE_DRAG_TYPE,
    JSON.stringify(movePayload),
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
  };
  setDraggedFile(data);
  e.dataTransfer?.setData('application/json', JSON.stringify(data));
}

function onDragEnd() {
  clearDraggedFile();
  dragOperation.value = null;
}

function onDragOverDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  const types = e.dataTransfer?.types;
  if (!types) return;

  if (types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) || types.includes(FILE_MANAGER_COPY_DRAG_TYPE)) {
    isDragOver.value = entry.path || null;
    dragOperation.value =
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE) || isLayer1Active(e, workspaceStore.userSettings)
        ? 'copy'
        : 'move';
    e.dataTransfer.dropEffect = dragOperation.value === 'copy' ? 'copy' : 'move';
    return;
  }

  if (types.includes(REMOTE_FILE_DRAG_TYPE)) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'copy';
    return;
  }

  // External files import
  if (types.includes('Files')) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'copy';
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
  }
}

async function onDropDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  e.stopPropagation();

  const operation = dragOperation.value;
  isDragOver.value = null;
  dragOperation.value = null;

  const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
  const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  const internalRaw = copyRaw || moveRaw;
  if (internalRaw) {
    const shouldCopy =
      !!copyRaw || isLayer1Active(e, workspaceStore.userSettings) || operation === 'copy';
    let parsed: any;
    try {
      parsed = JSON.parse(internalRaw);
    } catch {
      return;
    }

    const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];
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

const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory: (entry) =>
      isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies),
    folderHasVideos,
    isOpenableMediaFile,
    isConvertibleMediaFile,
    isTranscribableMediaFile,
    isVideo,
    getEntryMeta: ctx.getEntryMeta,
    isFilesPage: props.isFilesPage,
    getSelectedEntries: () => {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        if (selected.kind === 'multiple') return selected.entries;
        if ('entry' in selected) return [selected.entry];
      }
      return [];
    },
    get hasClipboardItems() {
      const clipboardStore = useAppClipboard();
      return clipboardStore.hasFileManagerPayload;
    },
  },
  (action: any, entry: any) => emit('action', action as any, entry),
);
</script>

<template>
  <ul class="select-none min-w-full w-max">
    <template v-for="entry in entries" :key="entry.name">
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
        <div v-if="entry.kind === 'directory' && entry.expanded && entry.children">
          <FileManagerTree
            :editing-entry-path="editingEntryPath"
            :entries="entry.children"
            :depth="depth + 1"
            :folders-only="foldersOnly"
            :is-files-page="isFilesPage"
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
        </div>
      </li>
    </template>
  </ul>
</template>
