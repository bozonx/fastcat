<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProxyStore } from '~/stores/proxy.store';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const {
  readDirectory,
  getFileIcon,
  findEntryByPath,
  mediaCache,
  vfs,
} = useFileManager();

const entries = ref<FsEntry[]>([]);
const isLoading = ref(false);

// Генерируем "хлебные крошки" для навигации назад
const breadcrumbs = computed(() => {
  const folder = filesPageStore.selectedFolder;
  if (!folder || !folder.path) return [];

  const parts = folder.path.split('/').filter(Boolean);
  const result: Array<{ name: string; path: string }> = [];
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    result.push({
      name: part === WORKSPACE_COMMON_PATH_PREFIX ? WORKSPACE_COMMON_DIR_NAME : part,
      path: currentPath,
    });
  }

  return result;
});

async function loadFolderContent() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) {
    // Если папка не выбрана, пытаемся открыть корень проекта
    await navigateToRoot();
    return;
  }

  isLoading.value = true;
  try {
    let content = await readDirectory(folder.path);
    if (!folder.path) {
      const commonMetadata = await vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
      if (commonMetadata?.kind === 'directory') {
        const commonEntry: FsEntry = {
          kind: 'directory',
          name: WORKSPACE_COMMON_DIR_NAME,
          path: WORKSPACE_COMMON_PATH_PREFIX,
        };
        content = [
          commonEntry,
          ...content.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
        ];
      }
    }
    // Фильтруем скрытые файлы
    entries.value = content.filter((e) => !e.name.startsWith('.'));
  } catch (error) {
    console.error('Failed to load mobile folder content:', error);
  } finally {
    isLoading.value = false;
  }
}

async function navigateToRoot() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: projectStore.currentProjectName || 'Root',
    path: '',
  });
}

async function navigateToWorkspaceCommonRoot() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: WORKSPACE_COMMON_DIR_NAME,
    path: WORKSPACE_COMMON_PATH_PREFIX,
  });
}

function handleEntryClick(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
  } else {
    // На мобильном сингл-клик выбирает файл
    filesPageStore.selectFile(entry);
  }
}

async function goBack() {
  const folder = filesPageStore.selectedFolder;
  if (!folder || !folder.path) return;

  const parentPath = getWorkspacePathParent(folder.path);

  if (!parentPath) {
    await navigateToRoot();
  } else if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
    await navigateToWorkspaceCommonRoot();
  } else {
    const parentEntry = findEntryByPath(parentPath);
    if (parentEntry) {
      filesPageStore.selectFolder(parentEntry);
    }
  }
}

function isSelected(entry: FsEntry) {
  const selected = selectionStore.selectedEntity;
  if (!selected || selected.source !== 'fileManager') return false;
  if ('path' in selected) {
    return selected.path === entry.path;
  }
  return false;
}

function isWorkspaceCommonRoot(entry: FsEntry) {
  return entry.kind === 'directory' && entry.path === WORKSPACE_COMMON_PATH_PREFIX;
}

function getStatusColor(entry: FsEntry) {
  if (entry.path && proxyStore.generatingProxies.has(entry.path)) return 'text-amber-400';
  if (entry.path && mediaCache.hasProxy(entry.path)) return 'text-green-500';
  return '';
}

// Следим за изменением выбранной папки
watch(
  () => filesPageStore.selectedFolder?.path,
  () => {
    void loadFolderContent();
  },
  { immediate: true },
);

onMounted(() => {
  if (!filesPageStore.selectedFolder) {
    void navigateToRoot();
  } else {
    void loadFolderContent();
  }
});
</script>

<template>
  <div class="flex flex-col h-full bg-slate-950 text-slate-200">
    <!-- Навигация (Breadcrumbs/Back) -->
    <div class="flex items-center gap-2 px-2 py-2 border-b border-slate-800 bg-slate-900/50">
      <UButton
        v-if="filesPageStore.selectedFolder?.path"
        icon="lucide:chevron-left"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="goBack"
      />
      <div class="flex-1 overflow-x-hidden">
        <div class="flex items-center gap-1 text-xs text-slate-400 overflow-x-auto no-scrollbar">
          <span class="shrink-0">{{ projectStore.currentProjectName }}</span>
          <template v-for="bc in breadcrumbs" :key="bc.path">
            <Icon name="lucide:chevron-right" class="w-3 h-3 opacity-30 shrink-0" />
            <span class="shrink-0 last:text-slate-100 last:font-medium">{{ bc.name }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- Список файлов -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div v-if="isLoading" class="flex items-center justify-center h-32">
        <Icon name="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
      </div>

      <div
        v-else-if="entries.length === 0"
        class="flex flex-col items-center justify-center h-64 opacity-30"
      >
        <Icon name="lucide:folder-open" class="w-12 h-12 mb-2" />
        <p class="text-sm">Empty folder</p>
      </div>

      <div v-else class="divide-y divide-slate-900">
        <button
          v-for="entry in entries"
          :key="entry.path"
          class="w-full flex items-center gap-3 px-4 py-3 active:bg-slate-900 transition-colors text-left"
          :class="{ 'bg-blue-600/10 ring-1 ring-blue-500/30 inset': isSelected(entry) }"
          @click="handleEntryClick(entry)"
        >
          <!-- Иконка / Превью -->
          <div
            class="w-10 h-10 rounded bg-slate-900 flex items-center justify-center shrink-0 overflow-hidden relative"
          >
            <Icon
              :name="getFileIcon(entry)"
              class="w-6 h-6"
              :class="[
                isWorkspaceCommonRoot(entry)
                  ? 'text-violet-400'
                  : entry.kind === 'directory'
                    ? 'text-slate-400'
                    : 'text-slate-400',
                getStatusColor(entry),
              ]"
            />

            <!-- Индикатор процесса прокси -->
            <div
              v-if="entry.path && proxyStore.generatingProxies.has(entry.path)"
              class="absolute inset-0 bg-black/40 flex items-center justify-center"
            >
              <div
                class="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"
              ></div>
            </div>
          </div>

          <!-- Информация -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-sm truncate" :class="getStatusColor(entry)">
                {{ entry.name }}
              </span>
              <span v-if="entry.kind === 'file'" class="text-[10px] text-slate-500 tabular-nums">
                {{ formatBytes((entry as any).size || 0) }}
              </span>
            </div>
            <div class="text-[10px] text-slate-500 flex items-center gap-2">
              <span>{{
                entry.kind === 'directory' ? 'Folder' : getMediaTypeFromFilename(entry.name)
              }}</span>
              <span v-if="entry.lastModified"
                >• {{ new Date(entry.lastModified).toLocaleDateString() }}</span
              >
            </div>
          </div>

          <Icon
            v-if="entry.kind === 'directory'"
            name="lucide:chevron-right"
            class="w-4 h-4 text-slate-700"
          />
        </button>
      </div>
    </div>

    <!-- Инфо-панель (только если что-то выбрано) -->
    <div
      v-if="
        selectionStore.selectedEntity?.source === 'fileManager' &&
        selectionStore.selectedEntity.kind === 'file'
      "
      class="bg-slate-900 p-3 border-t border-slate-800 animate-in slide-in-from-bottom-5"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold truncate">{{ selectionStore.selectedEntity.name }}</p>
          <p class="text-[10px] text-slate-500">File selected</p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="xs"
            color="primary"
            icon="lucide:plus"
            label="Add to project"
            @click="() => {}"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
