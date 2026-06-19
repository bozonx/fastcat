<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, computed, watch } from 'vue';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getMediaTypeFromFilename, validateMediaTrackCompatibility } from '~/utils/media-types';
import { secondsToUs } from '~/utils/time';
import type { FsEntry } from '~/types/fs';
import MobileFileBrowserGrid from '~/components/file-manager/MobileFileBrowserGrid.vue';
import { useUiStore } from '~/stores/ui.store';
import { useMediaTrackRedirectToast } from '~/composables/timeline/useMediaTrackRedirectToast';
const log = createDevLogger('MobileMediaPickerDrawer');
const toast = useToast();
const { captureSelectionKind, notifyRedirect } = useMediaTrackRedirectToast();

const props = defineProps<{ isOpen: boolean; isReplaceMode?: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'added'): void;
}>();

const { t } = useI18n();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();
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

async function resolveInsertDurationUs(
  entry: FsEntry,
  mediaType: string,
): Promise<number | undefined> {
  if (!entry.path) return undefined;
  if (mediaType === 'image' || mediaType === 'timeline') {
    return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
  }

  const meta = await mediaStore.getOrFetchMetadataByPath(entry.path);
  const duration = Number(meta?.duration);
  return Number.isFinite(duration) && duration > 0 ? secondsToUs(duration) : undefined;
}

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

  if (props.isReplaceMode && uiStore.mediaReplaceTarget) {
    return type === uiStore.mediaReplaceTarget.expectedType;
  }

  return ['video', 'audio', 'image', 'timeline'].includes(type);
}

async function loadEntries(path: string) {
  isLoading.value = true;
  try {
    const raw = await readDirectory(path);
    entries.value = raw.filter((e) => {
      const isCurrentTimeline = e.kind === 'file' && e.path === projectStore.currentTimelinePath;
      return !e.name.startsWith('.') && isMediaEntry(e) && !isCurrentTimeline;
    });
  } catch (err) {
    log.error('failed to load', path, err);
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

  // Block selection of fully unsupported files
  if (entry.path) {
    if (mediaStore.metadataLoadFailed[entry.path]) return;
    const meta = mediaStore.getCachedMetadata(entry.path);
    if (meta) {
      const type = getMediaTypeFromFilename(entry.name);
      if (type === 'image' && meta.image?.canDisplay === false) return;
      if (type === 'video' && meta.video?.canDecode === false) return;
      if (type === 'audio' && meta.audio?.canDecode === false) return;
    }
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
    if (props.isReplaceMode && uiStore.mediaReplaceTarget) {
      const targetClip = uiStore.mediaReplaceTarget;
      const entry = selectedFiles.value[0];
      if (entry && entry.path) {
        // Need to update clip properties with new path
        timelineStore.updateClipProperties(targetClip.trackId, targetClip.itemId, {
          source: { path: entry.path },
        });
        uiStore.mediaReplaceTarget = null;
        uiStore.isMediaReplaceModalOpen = false;
      }
    } else {
      const selectionKind = captureSelectionKind();
      const addedKinds: ('video' | 'audio')[] = [];
      for (const entry of selectedFiles.value) {
        if (!entry.path) continue;
        const mediaType = getMediaTypeFromFilename(entry.name);
        if (mediaType === 'timeline') {
          const durationUs = await resolveInsertDurationUs(entry, mediaType);
          await timelineStore.addTimelineClipToTimelineFromPath({
            trackId: timelineStore.resolveMobileTargetTrackId('video', { durationUs }),
            name: entry.name,
            path: entry.path,
            startUs: timelineStore.currentTime,
            pseudo: true,
          });
        } else {
          const kind = mediaType === 'audio' ? 'audio' : 'video';
          const durationUs = await resolveInsertDurationUs(entry, mediaType);
          const trackId = timelineStore.resolveMobileTargetTrackId(kind, { durationUs });

          const targetTrack = timelineStore.timelineDoc?.tracks.find((t) => t.id === trackId);
          if (!targetTrack || !validateMediaTrackCompatibility(mediaType, targetTrack.kind)) {
            toast.add({
              title: t('videoEditor.timeline.mediaTypeNotSupportedOnTrack'),
              color: 'warning',
            });
            continue;
          }

          await timelineStore.addClipToTimelineFromPath({
            trackId,
            name: entry.name,
            path: entry.path,
            startUs: timelineStore.currentTime,
            pseudo: true,
          });
          addedKinds.push(kind);
        }
      }
      notifyRedirect(selectionKind, addedKinds);
    }
    selectedFiles.value = [];
    emit('added');
    emit('close');
  } catch (err) {
    log.error('addToTimeline / replace failed', err);
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
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :snap-points="[0.85]">
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
              : t('videoEditor.fileManager.root')
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
          <template v-if="props.isReplaceMode">
            {{ t('fastcat.clip.replaceMedia') }}
          </template>
          <template v-else>
            {{ t('common.addToTimeline') }}
            <span class="ml-1 opacity-80">({{ selectedFiles.length }})</span>
          </template>
        </UButton>
      </div>
    </div>
  </UiMobileDrawer>
</template>
