<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useTimelineStore } from '~/stores/timeline.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import MobileFileBrowserGrid from '~/components/file-manager/MobileFileBrowserGrid.vue';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const { readDirectory, vfs } = useFileManager();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const currentPath = ref('');
const entries = ref<FsEntry[]>([]);
const isLoading = ref(false);
const selectedFiles = ref<FsEntry[]>([]);
const isAdding = ref(false);

const { thumbnails } = useFileManagerThumbnails(entries, vfs);

const breadcrumbs = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value
    .split('/')
    .filter(Boolean)
    .reduce<Array<{ name: string; path: string }>>((acc, part, idx, parts) => {
      acc.push({ name: part, path: parts.slice(0, idx + 1).join('/') });
      return acc;
    }, []);
});

function isMediaEntry(entry: FsEntry) {
  if (entry.kind === 'directory') return true;
  const type = getMediaTypeFromFilename(entry.name);
  return ['video', 'audio', 'image'].includes(type);
}

async function loadEntries(path: string) {
  isLoading.value = true;
  try {
    const raw = await readDirectory(path);
    entries.value = raw.filter((e) => !e.name.startsWith('.') && isMediaEntry(e));
  } catch (err) {
    console.error('MobileMediaPickerDrawer: failed to load', path, err);
    entries.value = [];
  } finally {
    isLoading.value = false;
  }
}

function handleToggleSelection(entry: FsEntry) {
  if (entry.kind === 'directory') {
    currentPath.value = entry.path;
    return;
  }
  const idx = selectedFiles.value.findIndex((f) => f.path === entry.path);
  if (idx === -1) {
    selectedFiles.value.push(entry);
  } else {
    selectedFiles.value.splice(idx, 1);
  }
}

function goBack() {
  if (!currentPath.value) return;
  const parts = currentPath.value.split('/').filter(Boolean);
  parts.pop();
  currentPath.value = parts.join('/');
}

async function addToTimeline() {
  if (!selectedFiles.value.length || isAdding.value) return;
  isAdding.value = true;
  try {
    for (const entry of selectedFiles.value) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name);
      const kind = mediaType === 'audio' ? 'audio' : 'video';
      const trackId = timelineStore.resolveMobileTargetTrackId(kind);

      await timelineStore.addClipToTimelineFromPath({
        trackId,
        name: entry.name,
        path: entry.path,
        startUs: timelineStore.currentTime,
        pseudo: true,
      });
    }
    selectedFiles.value = [];
    emit('close');
  } catch (err) {
    console.error('MobileMediaPickerDrawer: addToTimeline failed', err);
  } finally {
    isAdding.value = false;
  }
}

watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      currentPath.value = '';
      selectedFiles.value = [];
      void loadEntries('');
    }
  },
);

watch(currentPath, (path) => {
  void loadEntries(path);
});
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :snap-points="[0.85]" direction="bottom">
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <button
          v-if="currentPath"
          class="p-1 rounded-lg text-ui-text-muted hover:text-ui-text shrink-0"
          @click.stop="goBack"
        >
          <UIcon name="lucide:arrow-left" class="w-4 h-4" />
        </button>
        <span class="text-sm font-bold text-ui-text truncate">
          {{
            breadcrumbs.length
              ? breadcrumbs[breadcrumbs.length - 1]!.name
              : t('videoEditor.fileManager.root', 'Files')
          }}
        </span>
        <span
          v-if="selectedFiles.length"
          class="ml-auto shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400"
        >
          {{ selectedFiles.length }}
        </span>
      </div>
    </template>

    <div class="relative flex flex-col h-full">
      <div class="flex-1 overflow-y-auto pb-24">
        <MobileFileBrowserGrid
          :entries="entries"
          :thumbnails="thumbnails"
          :selected-entry-path="null"
          :selected-entries="selectedFiles"
          :is-selection-mode="true"
          :is-loading="isLoading"
          :folder-sizes="{}"
          @toggle-selection="handleToggleSelection"
        />
      </div>

      <div v-if="selectedFiles.length" class="absolute bottom-6 left-4 right-4 z-20">
        <UButton
          block
          size="lg"
          color="primary"
          :loading="isAdding"
          icon="lucide:plus"
          class="rounded-2xl font-bold shadow-lg shadow-primary-500/20 active:scale-[0.98] transition-all"
          @click="addToTimeline"
        >
          {{ t('common.addToTimeline', 'Add to timeline') }}
          <span class="ml-1 opacity-80">({{ selectedFiles.length }})</span>
        </UButton>
      </div>
    </div>
  </UiMobileDrawer>
</template>
