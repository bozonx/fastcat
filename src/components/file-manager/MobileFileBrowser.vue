<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProxyStore } from '~/stores/proxy.store';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineStore } from '~/stores/timeline.store';
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
const timelineStore = useTimelineStore();
const toast = useToast();
const { t } = useI18n();
const { readDirectory, getFileIcon, findEntryByPath, mediaCache, vfs } = useFileManager();

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

async function handleEntryPrimaryAction(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
    return;
  }

  filesPageStore.selectFile(entry);
  await handleAddToProject();
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

const selectedFile = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file') return null;
  return entity;
});

const selectedFileTypeLabel = computed(() => {
  if (!selectedFile.value) return '';
  return getMediaTypeFromFilename(selectedFile.value.name);
});

async function handleAddToProject() {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) return;

  const mediaType = getMediaTypeFromFilename(entity.name);
  if (mediaType === 'unknown') {
    toast.add({
      title: t('common.error', 'Error'),
      description: 'Unknown file type',
      color: 'error',
    });
    return;
  }

  try {
    const startUs = timelineStore.currentTime;
    const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
    const tracks = timelineStore.timelineDoc?.tracks || [];
    const trackId = tracks.find((t) => t.kind === targetTrackKind)?.id;

    if (!trackId) {
      toast.add({
        title: t('common.error', 'Error'),
        description: 'No suitable track found',
        color: 'error',
      });
      return;
    }

    if (mediaType === 'text') {
      const file = await vfs.getFile(entity.path);
      if (file) {
        const text = await file.text();
        await timelineStore.addVirtualClipToTrack({
          trackId,
          startUs,
          clipType: 'text',
          name: entity.name,
          text,
        });
      }
    } else {
      await timelineStore.addClipToTimelineFromPath({
        trackId,
        name: entity.name,
        path: entity.path,
        startUs,
      });
    }

    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: any) {
    toast.add({
      title: t('common.error', 'Error'),
      description: String(err?.message || err),
      color: 'error',
    });
  }
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
    <div class="flex items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-3 py-2.5">
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
      <div v-if="isLoading" class="flex h-32 items-center justify-center">
        <Icon name="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
      </div>

      <div
        v-else-if="entries.length === 0"
        class="flex flex-col items-center justify-center h-64 opacity-30"
      >
        <Icon name="lucide:folder-open" class="w-12 h-12 mb-2" />
        <p class="text-sm">Empty folder</p>
      </div>

      <div v-else class="divide-y divide-slate-900/70 px-2 py-2">
        <div v-for="entry in entries" :key="entry.path" class="overflow-hidden rounded-2xl">
          <button
            class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-slate-900"
            :class="{ 'bg-blue-600/10 ring-1 ring-blue-500/30 inset': isSelected(entry) }"
            @click="handleEntryClick(entry)"
          >
            <div
              class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900"
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

              <div
                v-if="entry.path && proxyStore.generatingProxies.has(entry.path)"
                class="absolute inset-0 flex items-center justify-center bg-black/40"
              >
                <div
                  class="h-3 w-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"
                ></div>
              </div>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium" :class="getStatusColor(entry)">
                  {{ entry.name }}
                </span>
                <span v-if="entry.kind === 'file'" class="text-[10px] tabular-nums text-slate-500">
                  {{ formatBytes((entry as any).size || 0) }}
                </span>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-slate-500">
                <span>{{
                  entry.kind === 'directory' ? 'Folder' : getMediaTypeFromFilename(entry.name)
                }}</span>
                <span v-if="entry.lastModified"
                  >• {{ new Date(entry.lastModified).toLocaleDateString() }}</span
                >
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                v-if="entry.kind === 'file'"
                size="xs"
                color="primary"
                variant="soft"
                icon="lucide:plus"
                aria-label="Add file to project"
                @click.stop="handleEntryPrimaryAction(entry)"
              />
              <Icon
                v-if="entry.kind === 'directory'"
                name="lucide:chevron-right"
                class="h-4 w-4 text-slate-700"
              />
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Инфо-панель (только если что-то выбрано) -->
    <div
      v-if="selectedFile"
      class="border-t border-slate-800 bg-slate-900 p-3 animate-in slide-in-from-bottom-5"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex-1 min-w-0">
          <p class="truncate text-xs font-semibold">{{ selectedFile.name }}</p>
          <p class="text-[10px] text-slate-500">
            {{ selectedFileTypeLabel }}
            <span v-if="selectedFile.path">• ready to add at playhead</span>
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="xs"
            color="primary"
            icon="lucide:plus"
            label="Add"
            @click="handleAddToProject"
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
