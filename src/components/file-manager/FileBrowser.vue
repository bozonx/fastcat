<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useFilesPageStore, type FileViewMode, type FileSortField, type SortOrder } from '~/stores/filesPage.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';

const filesPageStore = useFilesPageStore();
const { readDirectory, getFileIcon } = useFileManager();
const { t } = useI18n();

const folderEntries = ref<FsEntry[]>([]);
const isLoading = ref(false);

const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];

async function loadFolderContent() {
  if (!filesPageStore.selectedFolder || !filesPageStore.selectedFolder.handle) {
    folderEntries.value = [];
    return;
  }

  isLoading.value = true;
  try {
    const handle = filesPageStore.selectedFolder.handle as FileSystemDirectoryHandle;
    const path = filesPageStore.selectedFolder.path || '';
    const entries = await readDirectory(handle, path);
    
    // Supplement entries with more data (size, type) if needed for list/grid
    // We do this lazily or in parallel for the current view
    folderEntries.value = await supplementEntries(entries);
  } catch (error) {
    console.error('Failed to load folder content:', error);
    folderEntries.value = [];
  } finally {
    isLoading.value = false;
  }
}

interface ExtendedFsEntry extends FsEntry {
  size?: number;
  mimeType?: string;
  created?: number;
}

async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
  // We only get file sizes for files
  const supplements = await Promise.all(
    entries.map(async (entry) => {
      if (entry.kind === 'file') {
        try {
          const file = await (entry.handle as FileSystemFileHandle).getFile();
          return {
            ...entry,
            size: file.size,
            mimeType: file.type || getMimeFromExt(entry.name),
            lastModified: file.lastModified,
            created: file.lastModified, // Fallback as Web File API doesn't provide creation time
          };
        } catch (e) {
          return { ...entry, size: 0, mimeType: 'unknown' };
        }
      }
      return { ...entry, size: 0, mimeType: 'folder' };
    }),
  );
  return supplements;
}

function getMimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const type = getMediaTypeFromFilename(filename);
  if (type !== 'unknown') return type;
  return ext || 'file';
}

watch(() => filesPageStore.selectedFolder, loadFolderContent, { immediate: true });

const sortedEntries = computed(() => {
  const { field, order } = filesPageStore.sortOption;
  const entries = [...folderEntries.value];

  entries.sort((a: ExtendedFsEntry, b: ExtendedFsEntry) => {
    let result = 0;
    
    // Always keep directories at top (or bottom depending on sorting)
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }

    if (field === 'name') {
      result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (field === 'size') {
      result = (a.size || 0) - (b.size || 0);
    } else if (field === 'modified') {
      result = (a.lastModified || 0) - (b.lastModified || 0);
    } else if (field === 'created') {
      result = (a.created || 0) - (b.created || 0);
    } else if (field === 'type') {
      result = (a.mimeType || '').localeCompare(b.mimeType || '');
    }

    return order === 'asc' ? result : -result;
  });

  return entries;
});

const stats = computed(() => {
  let totalSize = 0;
  let fileCount = 0;
  
  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.kind === 'file') {
      totalSize += entry.size || 0;
      fileCount++;
    }
  }
  
  return {
    totalSize: formatBytes(totalSize),
    fileCount,
  };
});

function toggleViewMode() {
  filesPageStore.setViewMode(filesPageStore.viewMode === 'grid' ? 'list' : 'grid');
}

function handleEntryClick(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.selectFolder(entry);
  } else {
    filesPageStore.selectFile(entry);
  }
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg relative overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-4 px-4 py-2 border-b border-ui-border shrink-0 bg-ui-bg-elevated/50">
      <div class="flex items-center gap-1">
        <UButton
          :color="filesPageStore.viewMode === 'grid' ? 'primary' : 'neutral'"
          variant="ghost"
          icon="i-heroicons-squares-2x2"
          size="sm"
          @click="filesPageStore.setViewMode('grid')"
        />
        <UButton
          :color="filesPageStore.viewMode === 'list' ? 'primary' : 'neutral'"
          variant="ghost"
          icon="i-heroicons-list-bullet"
          size="sm"
          @click="filesPageStore.setViewMode('list')"
        />
      </div>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.sortBy', 'Sort by') }}:</span>
        <USelectMenu
          :items="sortFields"
          v-model="filesPageStore.sortOption.field"
          value-key="value"
          size="xs"
          class="w-32"
        />
        <UButton
          :icon="filesPageStore.sortOption.order === 'asc' ? 'i-heroicons-bars-arrow-up' : 'i-heroicons-bars-arrow-down'"
          variant="ghost"
          color="neutral"
          size="xs"
          @click="filesPageStore.sortOption.order = filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc'"
        />
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-auto p-4 content-scrollbar">
      <div v-if="isLoading" class="flex flex-col items-center justify-center h-full gap-4 text-ui-text-muted">
        <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
        <span>{{ t('common.loading', 'Loading...') }}</span>
      </div>

      <div v-else-if="!filesPageStore.selectedFolder" class="flex flex-col items-center justify-center h-full text-ui-text-muted gap-2">
        <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-20" />
        <span>{{ t('videoEditor.fileManager.selectFolderHint', 'Select a folder in the sidebar to view its contents') }}</span>
      </div>

      <div v-else-if="folderEntries.length === 0" class="flex flex-col items-center justify-center h-full text-ui-text-muted gap-2">
        <UIcon name="i-heroicons-inbox" class="w-12 h-12 opacity-20" />
        <span>{{ t('common.empty', 'Folder is empty') }}</span>
      </div>

      <!-- Grid View -->
      <div v-else-if="filesPageStore.viewMode === 'grid'" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        <div
          v-for="entry in sortedEntries"
          :key="entry.path"
          class="flex flex-col items-center p-3 rounded-lg border border-transparent hover:border-ui-border hover:bg-ui-bg-elevated cursor-pointer group transition-all"
          :class="{ 'bg-primary-500/10 border-primary-500/30': filesPageStore.selectedFile?.path === entry.path }"
          @click="handleEntryClick(entry)"
        >
          <div class="relative mb-2">
            <UIcon
              :name="getFileIcon(entry)"
              class="w-12 h-12"
              :class="entry.kind === 'directory' ? 'text-blue-400' : 'text-ui-text-muted'"
            />
          </div>
          <span class="text-xs text-center break-all line-clamp-2 px-1" :title="entry.name">
            {{ entry.name }}
          </span>
        </div>
      </div>

      <!-- List View -->
      <div v-else class="flex flex-col w-full min-w-max">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="text-ui-text-muted border-b border-ui-border">
              <th class="py-2 px-3 font-medium">{{ t('common.name', 'Name') }}</th>
              <th class="py-2 px-3 font-medium">{{ t('common.type', 'Type') }}</th>
              <th class="py-2 px-3 font-medium text-right">{{ t('common.size', 'Size') }}</th>
              <th class="py-2 px-3 font-medium">{{ t('common.created', 'Created') }}</th>
              <th class="py-2 px-3 font-medium">{{ t('common.modified', 'Modified') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in (sortedEntries as ExtendedFsEntry[])"
              :key="entry.path"
              class="hover:bg-ui-bg-elevated cursor-pointer group border-b border-ui-border/50"
              :class="{ 'bg-primary-500/10': filesPageStore.selectedFile?.path === entry.path }"
              @click="handleEntryClick(entry)"
            >
              <td class="py-2 px-3 flex items-center gap-2">
                <UIcon
                  :name="getFileIcon(entry)"
                  class="w-4 h-4 shrink-0"
                  :class="entry.kind === 'directory' ? 'text-blue-400' : 'text-ui-text-muted'"
                />
                <span class="truncate max-w-50" :title="entry.name">{{ entry.name }}</span>
              </td>
              <td class="py-2 px-3 text-ui-text-muted">
                {{ entry.kind === 'directory' ? t('common.folder', 'Folder') : entry.mimeType }}
              </td>
              <td class="py-2 px-3 text-right text-ui-text-muted">
                {{ entry.kind === 'file' ? formatBytes(entry.size || 0) : '-' }}
              </td>
              <td class="py-2 px-3 text-ui-text-muted">
                {{ formatDate(entry.created) }}
              </td>
              <td class="py-2 px-3 text-ui-text-muted">
                {{ formatDate(entry.lastModified) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bottom Panel -->
    <div class="px-4 py-2 border-t border-ui-border shrink-0 bg-ui-bg-elevated/50 flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-ui-text-muted">
      <div v-if="filesPageStore.selectedFolder" class="flex items-center gap-4">
        <span>{{ t('common.totalSize', 'Total Size') }}: <span class="text-ui-text">{{ stats.totalSize }}</span></span>
        <span>{{ t('common.filesCount', 'Files') }}: <span class="text-ui-text">{{ stats.fileCount }}</span></span>
      </div>
      <div class="ml-auto" v-if="filesPageStore.selectedFolder">
        <span class="text-ui-text-disabled">{{ filesPageStore.selectedFolder.path }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.content-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.content-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(var(--color-neutral-500), 0.1);
  border-radius: 3px;
}

.content-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--color-neutral-500), 0.2);
}
</style>
