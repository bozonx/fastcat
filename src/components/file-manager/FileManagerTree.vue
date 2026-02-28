<script setup lang="ts">
import { ref } from 'vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { VIDEO_DIR_NAME } from '~/utils/constants';
import type { FsEntry } from '~/types/fs';

interface Props {
  entries: FsEntry[];
  depth: number;
  getFileIcon: (entry: FsEntry) => string;
  selectedPath: string | null;
  getEntryMeta: (entry: FsEntry) => {
    hasProxy: boolean;
    generatingProxy: boolean;
    proxyProgress?: number;
  };
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (e: 'select', entry: FsEntry): void;
  (
    e: 'action',
    action:
      | 'createFolder'
      | 'rename'
      | 'info'
      | 'delete'
      | 'createProxy'
      | 'cancelProxy'
      | 'deleteProxy'
      | 'upload'
      | 'createProxyForFolder',
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

const isDragOver = ref<string | null>(null);

function isDotEntry(entry: FsEntry): boolean {
  return entry.name.startsWith('.');
}

function isSelected(entry: FsEntry): boolean {
  if (!props.selectedPath) return false;
  if (!entry.path) return false;
  return props.selectedPath === entry.path;
}

function getEntryIconClass(entry: FsEntry): string {
  if (isDotEntry(entry)) return 'opacity-30';
  if (entry.kind === 'directory') return 'text-ui-text-muted/80';

  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'text-violet-400/90';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'text-emerald-400/90';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'text-sky-400/90';
  if (['otio', 'txt', 'md', 'json', 'yaml', 'yml'].includes(ext)) return 'text-amber-400/90';
  return 'text-ui-text-muted';
}

function isVideo(entry: FsEntry) {
  return (
    entry.kind === 'file' &&
    entry.path?.startsWith(`${VIDEO_DIR_NAME}/`)
  );
}

function onEntryClick(entry: FsEntry) {
  emit('select', entry);
}

function onCaretClick(e: MouseEvent, entry: FsEntry) {
  e.stopPropagation();
  if (entry.kind !== 'directory') return;
  emit('toggle', entry);
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (!entry.path) return;

  const movePayload = {
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
  };
  e.dataTransfer?.setData(FILE_MANAGER_MOVE_DRAG_TYPE, JSON.stringify(movePayload));

  // Mark this as an internal drag so the global drop overlay is not shown
  e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

  if (entry.kind !== 'file') return;

  const isTimeline = entry.name.toLowerCase().endsWith('.otio');
  const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
  const data = {
    name: entry.name,
    kind,
    path: entry.path,
    handle: entry.handle as FileSystemFileHandle,
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
  if (!entry.children) return true; // Assume true if not loaded yet, or we can be conservative
  return entry.children.some((child) => {
    if (child.kind === 'file') {
      const ext = child.name.split('.').pop()?.toLowerCase() ?? '';
      return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
    }
    return false;
  });
}

function getContextMenuItems(entry: FsEntry) {
  const items = [];

  if (entry.kind === 'directory') {
    const hasVideos = folderHasVideos(entry);

    items.push([
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => emit('action', 'createFolder', entry),
      },
      {
        label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: () => emit('action', 'upload', entry),
      },
    ]);

    if (hasVideos) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.createProxyForAll', 'Create proxy for all videos'),
          icon: 'i-heroicons-film',
          onSelect: () => emit('action', 'createProxyForFolder' as any, entry),
        },
      ]);
    }
  }

  items.push([
    {
      label: t('common.rename', 'Rename'),
      icon: 'i-heroicons-pencil',
      onSelect: () => emit('action', 'rename', entry),
    },
    {
      label: t('videoEditor.fileManager.info.title', 'Information'),
      icon: 'i-heroicons-information-circle',
      onSelect: () => emit('action', 'info', entry),
    },
  ]);

  if (isVideo(entry)) {
    const meta = props.getEntryMeta(entry);
    const hasProxy = meta.hasProxy;
    const generatingProxy = meta.generatingProxy;

    items.push([
      {
        label: generatingProxy
          ? t('videoEditor.fileManager.actions.generatingProxy', 'Generating Proxy...')
          : hasProxy
            ? t('videoEditor.fileManager.actions.regenerateProxy', 'Regenerate Proxy')
            : t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
        icon: generatingProxy ? 'i-heroicons-arrow-path' : 'i-heroicons-film',
        disabled: generatingProxy,
        onSelect: () => emit('action', 'createProxy', entry),
      },
    ]);

    if (generatingProxy) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.cancelProxyGeneration', 'Cancel proxy generation'),
          icon: 'i-heroicons-x-circle',
          color: 'error',
          onSelect: () => emit('action', 'cancelProxy', entry),
        },
      ]);
    }

    if (hasProxy) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.deleteProxy', 'Delete Proxy'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => emit('action', 'deleteProxy', entry),
        },
      ]);
    }
  }

  items.push([
    {
      label: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      color: 'error',
      onSelect: () => emit('action', 'delete', entry),
    },
  ]);

  return items;
}
</script>

<template>
  <ul class="select-none min-w-full w-max">
    <li v-for="entry in entries" :key="entry.name">
      <!-- Row -->
      <UContextMenu :items="getContextMenuItems(entry)">
        <div
          class="flex items-center gap-1.5 py-1 pr-2 rounded cursor-pointer hover:bg-ui-bg-hover transition-colors group min-w-fit"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          :class="[
            isDragOver === entry.path ? 'bg-primary-500/20 outline outline-primary-500 -outline-offset-1' : '',
            isSelected(entry) ? 'bg-ui-bg-elevated outline-1 outline-(--selection-ring) -outline-offset-1' : '',
          ]"
          :draggable="true"
          :aria-selected="isSelected(entry)"
          :aria-expanded="entry.kind === 'directory' ? entry.expanded : undefined"
          :aria-level="depth + 1"
          role="treeitem"
          tabindex="0"
          @keydown.enter="onEntryClick(entry)"
          @keydown.space.prevent="onEntryClick(entry)"
          @dragstart="onDragStart($event, entry)"
          @dragend="onDragEnd()"
          @dragover.prevent="onDragOverDir($event, entry)"
          @dragleave.prevent="onDragLeaveDir($event, entry)"
          @drop.prevent="onDropDir($event, entry)"
          @click="onEntryClick(entry)"
        >
          <!-- Chevron for directories -->
          <UIcon
            v-if="entry.kind === 'directory'"
            name="i-heroicons-chevron-right"
            class="w-3.5 h-3.5 text-ui-text-muted shrink-0 transition-transform duration-150"
            :class="{ 'rotate-90': entry.expanded }"
            :aria-hidden="true"
            @click="onCaretClick($event, entry)"
          />
          <span v-else class="w-3.5 shrink-0" />

          <!-- File / folder icon -->
          <UIcon
            :name="getFileIcon(entry)"
            class="w-4 h-4 shrink-0 transition-colors"
            :class="[
              getEntryIconClass(entry),
              props.getEntryMeta(entry).hasProxy ? 'text-(--color-success)!' : '',
            ]"
          />

          <!-- Name -->
          <span
            class="text-sm truncate transition-colors"
            :class="[
              isSelected(entry) ? 'font-medium text-ui-text group-hover:text-ui-text' : 'text-ui-text group-hover:text-ui-text',
              isDotEntry(entry) ? 'opacity-30' : '',
              props.getEntryMeta(entry).hasProxy ? 'text-(--color-success)!' : '',
            ]"
          >
            {{ entry.name }}
          </span>

          <!-- Proxy indicators -->
          <template v-if="isVideo(entry)">
            <div v-if="props.getEntryMeta(entry).generatingProxy" class="flex items-center gap-1 ml-2">
              <UIcon
                name="i-heroicons-arrow-path"
                class="w-3.5 h-3.5 text-primary-400 animate-spin"
              />
              <span
                v-if="props.getEntryMeta(entry).proxyProgress !== undefined"
                class="text-xs text-primary-400 font-mono"
              >
                {{ props.getEntryMeta(entry).proxyProgress }}%
              </span>
            </div>
          </template>
        </div>
      </UContextMenu>

      <!-- Children -->
      <div v-if="entry.kind === 'directory' && entry.expanded && entry.children">
        <FileManagerTree
          :entries="entry.children"
          :depth="depth + 1"
          :get-file-icon="getFileIcon"
          :selected-path="selectedPath"
          :get-entry-meta="getEntryMeta"
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
          @action="(action, childEntry) => emit('action', action, childEntry)"
          @request-move="emit('requestMove', $event)"
          @request-upload="emit('requestUpload', $event)"
        />
      </div>
    </li>
  </ul>
</template>
