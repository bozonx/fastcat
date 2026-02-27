<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProxyStore } from '~/stores/proxy.store';
import { useUiStore } from '~/stores/ui.store';
import { useDraggedFile } from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { SOURCES_DIR_NAME } from '~/utils/constants';

interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: FsEntry[];
  expanded?: boolean;
  path?: string;
}

interface Props {
  entries: FsEntry[];
  depth: number;
  getFileIcon: (entry: FsEntry) => string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void;
  (e: 'select', entry: FsEntry): void;
  (
    e: 'action',
    action: 'createFolder' | 'rename' | 'info' | 'delete' | 'createProxy' | 'deleteProxy',
    entry: FsEntry,
  ): void;
}>();

const { t } = useI18n();
const proxyStore = useProxyStore();
const uiStore = useUiStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

const isDragOver = ref<string | null>(null);

function isVideo(entry: FsEntry) {
  return entry.kind === 'file' && entry.path?.startsWith(`${SOURCES_DIR_NAME}/video/`);
}

function hasProxy(entry: FsEntry) {
  return isVideo(entry) && entry.path ? proxyStore.existingProxies.has(entry.path) : false;
}

function isGeneratingProxy(entry: FsEntry) {
  return isVideo(entry) && entry.path ? proxyStore.generatingProxies.has(entry.path) : false;
}

function proxyProgress(entry: FsEntry) {
  return isVideo(entry) && entry.path ? proxyStore.proxyProgress[entry.path] : undefined;
}

function onEntryClick(entry: FsEntry) {
  if (entry.kind === 'directory') {
    emit('toggle', entry);
  } else {
    emit('select', entry);
  }
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'file') return;
  const isTimeline = entry.name.toLowerCase().endsWith('.otio');
  const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
  const data = {
    name: entry.name,
    kind,
    path: entry.path || '',
    handle: entry.handle as FileSystemFileHandle,
  };
  setDraggedFile(data);
}

function onDragEnd() {
  clearDraggedFile();
}

function onDragOverDir(e: DragEvent, entry: FsEntry) {
  // Only handle directory targets and external files
  if (entry.kind === 'directory' && e.dataTransfer?.types.includes('Files')) {
    isDragOver.value = entry.path || null;
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onDragLeaveDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind === 'directory' && isDragOver.value === entry.path) {
    isDragOver.value = null;
  }
}

async function onDropDir(e: DragEvent, entry: FsEntry) {
  if (entry.kind === 'directory' && isDragOver.value === entry.path) {
    isDragOver.value = null;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const { useFileManager } = await import('~/composables/fileManager/useFileManager');
      const fm = useFileManager();
      await fm.handleFiles(e.dataTransfer.files, entry.handle as FileSystemDirectoryHandle);
    }
  }
}

function getContextMenuItems(entry: FsEntry) {
  const items = [];

  if (entry.kind === 'directory') {
    items.push([
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => emit('action', 'createFolder', entry),
      },
    ]);
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
    const hasP = hasProxy(entry);
    const generating = isGeneratingProxy(entry);

    items.push([
      {
        label: generating
          ? t('videoEditor.fileManager.actions.generatingProxy', 'Generating Proxy...')
          : hasP
            ? t('videoEditor.fileManager.actions.regenerateProxy', 'Regenerate Proxy')
            : t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
        icon: generating ? 'i-heroicons-arrow-path' : 'i-heroicons-film',
        disabled: generating,
        onSelect: () => emit('action', 'createProxy', entry),
      },
    ]);

    if (hasP) {
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
          :class="{ 'bg-primary-500/20 outline outline-primary-500 -outline-offset-1': isDragOver === entry.path }"
          :draggable="entry.kind === 'file'"
          @dragstart="onDragStart($event, entry)"
          @dragend="onDragEnd()"
          @dragover.prevent="onDragOverDir($event, entry)"
          @dragleave.prevent="onDragLeaveDir($event, entry)"
          @drop.prevent="onDropDir($event, entry)"
          @click.stop="onEntryClick(entry)"
          @pointerdown.stop="uiStore.selectedFsEntry = entry as any"
        >
          <!-- Chevron for directories -->
          <UIcon
            v-if="entry.kind === 'directory'"
            name="i-heroicons-chevron-right"
            class="w-3.5 h-3.5 text-ui-text-muted shrink-0 transition-transform duration-150"
            :class="{ 'rotate-90': entry.expanded }"
          />
          <span v-else class="w-3.5 shrink-0" />

          <!-- File / folder icon -->
          <UIcon
            :name="getFileIcon(entry)"
            class="w-4 h-4 shrink-0 transition-colors"
            :class="[
              entry.kind === 'directory' ? 'text-ui-text-muted' : 'text-ui-text-muted',
              hasProxy(entry) ? 'text-(--color-success)!' : '',
            ]"
          />

          <!-- Name -->
          <span
            class="text-sm truncate transition-colors"
            :class="[
              uiStore.selectedFsEntry?.handle.isSameEntry(entry.handle)
                ? 'font-medium text-ui-text group-hover:text-ui-text'
                : 'text-ui-text group-hover:text-ui-text',
              hasProxy(entry) ? 'text-(--color-success)!' : '',
            ]"
          >
            {{ entry.name }}
          </span>

          <!-- Proxy indicators -->
          <template v-if="isVideo(entry)">
            <div v-if="isGeneratingProxy(entry)" class="flex items-center gap-1 ml-2">
              <UIcon
                name="i-heroicons-arrow-path"
                class="w-3.5 h-3.5 text-primary-400 animate-spin"
              />
              <span
                v-if="proxyProgress(entry) !== undefined"
                class="text-xs text-primary-400 font-mono"
              >
                {{ proxyProgress(entry) }}%
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
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
          @action="(a, e) => emit('action', a, e)"
        />
      </div>
    </li>
  </ul>
</template>
