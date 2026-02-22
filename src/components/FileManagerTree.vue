<script setup lang="ts">

interface FsEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  children?: FsEntry[]
  expanded?: boolean
  path?: string
}

interface Props {
  entries: FsEntry[]
  depth: number
  getFileIcon: (entry: FsEntry) => string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'toggle', entry: FsEntry): void
  (e: 'select', entry: FsEntry): void
  (e: 'action', action: 'createFolder' | 'rename' | 'info' | 'delete', entry: FsEntry): void
}>()

const { t } = useI18n()

function onEntryClick(entry: FsEntry) {
  if (entry.kind === 'directory') {
    emit('toggle', entry)
  } else {
    emit('select', entry)
  }
}

function onDragStart(e: DragEvent, entry: FsEntry) {
  if (entry.kind !== 'file') return
  if (e.dataTransfer) {
    e.dataTransfer.setData('application/json', JSON.stringify({
      name: entry.name,
      kind: 'file',
      path: entry.path
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }
}

function getContextMenuItems(entry: FsEntry) {
  const items = []
  
  if (entry.kind === 'directory') {
    items.push([{
      label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
      icon: 'i-heroicons-folder-plus',
      onSelect: () => emit('action', 'createFolder', entry)
    }])
  }
  
  items.push([{
    label: t('common.rename', 'Rename'),
    icon: 'i-heroicons-pencil',
    onSelect: () => emit('action', 'rename', entry)
  }, {
    label: t('videoEditor.fileManager.info.title', 'Information'),
    icon: 'i-heroicons-information-circle',
    onSelect: () => emit('action', 'info', entry)
  }, {
    label: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    color: 'error',
    onSelect: () => emit('action', 'delete', entry)
  }])
  
  return items
}
</script>

<template>
  <ul class="select-none min-w-full w-max">
    <li
      v-for="entry in entries"
      :key="entry.name"
    >
      <!-- Row -->
      <UContextMenu :items="getContextMenuItems(entry)">
        <div
          class="flex items-center gap-1.5 py-1 pr-2 rounded cursor-pointer hover:bg-gray-800 transition-colors group min-w-fit"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          :draggable="entry.kind === 'file'"
          @dragstart="onDragStart($event, entry)"
          @click="onEntryClick(entry)"
        >
          <!-- Chevron for directories -->
          <UIcon
            v-if="entry.kind === 'directory'"
            name="i-heroicons-chevron-right"
            class="w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform duration-150"
            :class="{ 'rotate-90': entry.expanded }"
          />
          <span v-else class="w-3.5 shrink-0" />

          <!-- File / folder icon -->
          <UIcon
            :name="getFileIcon(entry)"
            class="w-4 h-4 shrink-0"
            :class="entry.kind === 'directory' ? 'text-yellow-500' : 'text-gray-400'"
          />

          <!-- Name -->
          <span class="text-sm text-gray-300 whitespace-nowrap flex-1 group-hover:text-white">
            {{ entry.name }}
          </span>
        </div>
      </UContextMenu>

      <!-- Children (recursive) -->
      <FileManagerTree
        v-if="entry.kind === 'directory' && entry.expanded && entry.children"
        :entries="entry.children"
        :depth="depth + 1"
        :get-file-icon="getFileIcon"
        @toggle="$emit('toggle', $event)"
        @select="$emit('select', $event)"
        @action="(action, e) => $emit('action', action, e)"
      />
    </li>
  </ul>
</template>
