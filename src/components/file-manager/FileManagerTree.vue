<script setup lang="ts">
import { ref, inject } from 'vue';
import type { ComputedRef } from 'vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import { useProxyStore } from '~/stores/proxy.store';
import { useSelectionStore } from '~/stores/selection.store';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import { useFileContextMenu } from '~/composables/fileManager/useFileContextMenu';

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
  (
    e: 'action',
    action:
      | 'createFolder'
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
      | 'openAsPanel'
      | 'openAsProjectTab',
    entry: FsEntry,
  ): void;
  (
    e: 'requestMove',
    params: {
      sourcePath: string;
      targetDirHandle: FileSystemDirectoryHandle;
      targetDirPath: string;
    },
  ): void;
  (
    e: 'requestUpload',
    params: {
      files: File[];
      targetDirHandle: FileSystemDirectoryHandle;
      targetDirPath: string;
    },
  ): void;
}>();

const { t } = useI18n();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();
const proxyStore = useProxyStore();

function isGeneratingProxyInDirectory(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const dirPath = entry.path;
  for (const p of proxyStore.generatingProxies) {
    if (!dirPath) {
      if (!p.includes('/')) return true;
    } else {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) return true;
      }
    }
  }
  return false;
}

const isDragOver = ref<string | null>(null);

function isDotEntry(entry: FsEntry): boolean {
  return entry.name.startsWith('.');
}

const selectionStore = useSelectionStore();

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

function getEntryIconClass(entry: FsEntry): string {
  if (isDotEntry(entry)) return 'opacity-30';
  if (isGeneratingProxyInDirectory(entry)) return 'text-amber-400/90';
  if (entry.kind === 'directory') return 'text-ui-text-muted/80';

  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'text-violet-400/90';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'text-emerald-400/90';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'text-sky-400/90';
  if (['otio', 'txt', 'md', 'json', 'yaml', 'yml'].includes(ext)) return 'text-amber-400/90';
  return 'text-ui-text-muted';
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

function onEntryClick(event: MouseEvent, entry: FsEntry) {
  emit('select', entry, event);
}

function onEntryEnter(event: KeyboardEvent, entry: FsEntry) {
  if (entry.kind === 'directory') {
    emit('toggle', entry);
    emit('select', entry); // No mouse event for keyboard
  } else {
    emit('select', entry);
  }
}

function onCaretClick(e: MouseEvent, entry: FsEntry) {
  e.stopPropagation();
  if (entry.kind !== 'directory') return;
  emit('toggle', entry);
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (!entry.path) return;

  const selectionStore = useSelectionStore();
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

  e.dataTransfer?.effectAllowed && (e.dataTransfer.effectAllowed = 'copyMove');

  const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
  e.dataTransfer?.setData(FILE_MANAGER_MOVE_DRAG_TYPE, JSON.stringify(movePayload));

  // Mark this as an internal drag so the global drop overlay is not shown
  e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

  if (entry.kind !== 'file') return;

  const isTimeline = entry.name.toLowerCase().endsWith('.otio');
  const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
  const data: DraggedFileData = {
    name: entry.name,
    kind,
    path: entry.path,
    count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
    items: movePayload,
  };
  setDraggedFile(data);
  e.dataTransfer?.setData('application/json', JSON.stringify(data));
}

function onDragEnd() {
  clearDraggedFile();
}

function onDragOverDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  const types = e.dataTransfer?.types;
  if (!types) return;

  if (types.includes(FILE_MANAGER_MOVE_DRAG_TYPE)) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'move';
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
  }
}

async function onDropDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  e.stopPropagation();

  isDragOver.value = null;

  const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  if (moveRaw) {
    let parsed: any;
    try {
      parsed = JSON.parse(moveRaw);
    } catch {
      return;
    }

    const sourcePath = typeof parsed?.path === 'string' ? parsed.path : '';
    if (!sourcePath) return;

    emit('requestMove', {
      sourcePath,
      targetDirHandle: entry.handle as FileSystemDirectoryHandle,
      targetDirPath: entry.path ?? '',
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
    targetDirHandle: entry.handle as FileSystemDirectoryHandle,
    targetDirPath: entry.path ?? '',
  });
}

function folderHasVideos(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  if (!entry.children) return false;
  return entry.children.some((child) => {
    if (child.kind === 'file') {
      const ext = child.name.split('.').pop()?.toLowerCase() ?? '';
      return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
    }
    return false;
  });
}

const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory,
    folderHasVideos,
    isOpenableMediaFile,
    isConvertibleMediaFile,
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
          <div
            class="flex items-center gap-1.5 py-1 pr-2 rounded cursor-pointer hover:bg-ui-bg-hover transition-colors group min-w-fit"
            :style="{ paddingLeft: `${8 + depth * 14}px` }"
            :class="[
              isDragOver === entry.path
                ? 'bg-primary-500/20 outline outline-primary-500 -outline-offset-1'
                : '',
              isSelected(entry)
                ? 'bg-ui-bg-elevated outline-1 outline-(--selection-ring) -outline-offset-1'
                : '',
            ]"
            :draggable="true"
            :aria-selected="isSelected(entry)"
            :aria-expanded="entry.kind === 'directory' ? entry.expanded : undefined"
            :aria-level="depth + 1"
            role="treeitem"
            tabindex="0"
            @keydown.enter.prevent="onEntryEnter($event, entry)"
            @keydown.space.prevent="onEntryEnter($event, entry)"
            @dragstart="onDragStart($event, entry)"
            @dragend="onDragEnd()"
            @dragover.prevent="onDragOverDir($event, entry)"
            @dragleave.prevent="onDragLeaveDir($event, entry)"
            @drop.prevent="onDropDir($event, entry)"
            @click="onEntryClick($event, entry)"
            @dblclick.stop="emit('action', 'rename', entry)"
          >
            <!-- Chevron for directories -->
            <UIcon
              v-if="
                entry.kind === 'directory' &&
                (!foldersOnly ||
                  !entry.children ||
                  entry.children.some((c) => c.kind === 'directory'))
              "
              name="i-heroicons-chevron-right"
              class="w-3.5 h-3.5 text-ui-text-muted shrink-0 transition-transform duration-150"
              :class="{ 'rotate-90': entry.expanded }"
              :aria-hidden="true"
              @click="onCaretClick($event, entry)"
            />
            <span v-else class="w-3.5 shrink-0" />

            <!-- File / folder icon -->
            <div class="w-4 shrink-0 flex items-center justify-center">
              <div
                class="h-4 flex items-center justify-center"
                :class="[
                  ctx.getEntryMeta(entry).isUsedInTimeline ? 'border-b-2 border-red-500' : '',
                ]"
              >
                <div
                  v-if="ctx.getEntryMeta(entry).generatingProxy"
                  class="w-4 h-4 shrink-0 relative flex items-center justify-center"
                  :title="`${ctx.getEntryMeta(entry).proxyProgress ?? 0}%`"
                >
                  <ProgressSpinner
                    :progress="ctx.getEntryMeta(entry).proxyProgress ?? 0"
                    size="sm"
                  />
                </div>
                <UIcon
                  v-else
                  :name="ctx.getFileIcon(entry)"
                  class="w-4 h-4 shrink-0 transition-colors"
                  :class="[
                    getEntryIconClass(entry),
                    ctx.getEntryMeta(entry).hasProxy ? 'text-(--color-success)!' : '',
                  ]"
                />
              </div>
            </div>

            <!-- Name -->
            <InlineNameEditor
              v-if="editingEntryPath === entry.path"
              :initial-name="entry.name"
              :is-folder="entry.kind === 'directory'"
              :existing-names="(entries || []).map((e) => e.name)"
              @save="(name) => emit('commitRename', entry, name)"
              @cancel="emit('stopRename')"
            />
            <span
              v-else
              class="text-sm truncate transition-colors"
              :class="[
                isSelected(entry)
                  ? 'font-medium text-ui-text group-hover:text-ui-text'
                  : 'text-ui-text group-hover:text-ui-text',
                isDotEntry(entry) ? 'opacity-30' : '',
                ctx.getEntryMeta(entry).hasProxy && !ctx.getEntryMeta(entry).generatingProxy
                  ? 'text-(--color-success)!'
                  : '',
                ctx.getEntryMeta(entry).generatingProxy || isGeneratingProxyInDirectory(entry)
                  ? 'text-amber-400!'
                  : '',
              ]"
            >
              {{ entry.name }}
            </span>
          </div>
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
            @action="(action, childEntry) => emit('action', action, childEntry)"
            @request-move="emit('requestMove', $event)"
            @request-upload="emit('requestUpload', $event)"
          />
        </div>
      </li>
    </template>
  </ul>
</template>
