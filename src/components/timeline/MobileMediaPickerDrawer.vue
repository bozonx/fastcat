<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import {
  FILE_MANAGER_INJECTION_KEY,
  useFileManager,
} from '~/composables/file-manager/useFileManager';
import { useMobileAssetCategories } from '~/composables/file-manager/useMobileAssetCategories';
import { usePullToRefresh } from '~/composables/file-manager/usePullToRefresh';
import { useMediaTrackRedirectToast } from '~/composables/timeline/useMediaTrackRedirectToast';
import { useMediaStore } from '~/stores/media.store';
import { useMobileMediaPickerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { FsEntry } from '~/types/fs';
import { createDevLogger } from '~/utils/dev-logger';
import { getMediaTypeFromFilename, validateMediaTrackCompatibility } from '~/utils/media-types';
import { secondsToUs } from '~/utils/time';
import MobileAssetCategoryList from '~/components/file-manager/MobileAssetCategoryList.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useMobileDrawerOpen } from '~/composables/ui/useMobileDrawerOpen';

const log = createDevLogger('MobileMediaPickerDrawer');

const props = defineProps<{ isOpen: boolean; isReplaceMode?: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'added'): void;
}>();

const { t } = useI18n();
const toast = useToast();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();
const assetStore = useMobileMediaPickerStore();
const { captureSelectionKind, notifyRedirect } = useMediaTrackRedirectToast();

const fileManager = useFileManager({ shouldRecordFileManagerHistory: () => false });
provide(FILE_MANAGER_INJECTION_KEY, fileManager);
provide('fileManagerStore', assetStore);

const { vfs, readDirectory } = fileManager;
const { categories, loadAll, toggleCollapse, isCollapsed } = useMobileAssetCategories({
  vfs,
  readDirectory,
  fileManagerStore: assetStore,
});

const isOpenLocal = useMobileDrawerOpen(props, emit);

const selectedFiles = ref<FsEntry[]>([]);
const isAdding = ref(false);

// The media type of the current multi-selection (first picked file). While set, only files of the
// same type stay selectable so a batch always lands on a single track without mixed-kind routing.
const selectedMediaType = computed(() =>
  selectedFiles.value[0] ? getMediaTypeFromFilename(selectedFiles.value[0].name) : null,
);

function isSelectableEntry(entry: FsEntry): boolean {
  if (entry.kind !== 'file' || !entry.path || entry.path === projectStore.currentTimelinePath) {
    return false;
  }

  const mediaType = getMediaTypeFromFilename(entry.name);
  if (!['video', 'audio', 'image', 'timeline'].includes(mediaType)) return false;

  if (props.isReplaceMode && uiStore.mediaReplaceTarget) {
    if (mediaType !== uiStore.mediaReplaceTarget.expectedType) return false;

    // Hide the file that is already set as the clip's source.
    const clip = timelineStore.timelineDoc?.tracks
      .find((track) => track.id === uiStore.mediaReplaceTarget!.trackId)
      ?.items.find((item) => item.id === uiStore.mediaReplaceTarget!.itemId);
    if (clip && 'source' in clip && clip.source?.path === entry.path) return false;

    return true;
  }

  // Forbid mixing media types within one multi-selection.
  if (selectedMediaType.value && mediaType !== selectedMediaType.value) return false;

  return true;
}

const visibleCategories = categories.map((category) => ({
  ...category,
  sortedEntries: computed(() => category.sortedEntries.value.filter(isSelectableEntry)),
}));

const sortFieldOptions = computed(() => [
  { label: t('common.modified'), value: 'modified' },
  { label: t('common.name'), value: 'name' },
  { label: t('common.size'), value: 'size' },
]);

function toggleSortOrder() {
  assetStore.sortOption.order = assetStore.sortOption.order === 'asc' ? 'desc' : 'asc';
}

async function reloadAll() {
  await loadAll(true);
}

const { isPulling, pullDistance, isRefreshing, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(reloadAll);

function handleToggleSelection(entry: FsEntry) {
  if (!isSelectableEntry(entry)) return;
  if (mediaStore.metadataLoadFailed[entry.path!]) return;

  const metadata = mediaStore.getCachedMetadata(entry.path!);
  const mediaType = getMediaTypeFromFilename(entry.name);
  if (
    (mediaType === 'image' && metadata?.image?.canDisplay === false) ||
    (mediaType === 'video' && metadata?.video?.canDecode === false) ||
    (mediaType === 'audio' && metadata?.audio?.canDecode === false)
  ) {
    return;
  }

  const index = selectedFiles.value.findIndex((file) => file.path === entry.path);
  if (index === -1) {
    selectedFiles.value.push(entry);
  } else {
    selectedFiles.value.splice(index, 1);
  }
}

async function resolveInsertDurationUs(
  entry: FsEntry,
  mediaType: string,
): Promise<number | undefined> {
  if (!entry.path) return undefined;
  if (mediaType === 'image' || mediaType === 'timeline') {
    return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
  }

  const metadata = await mediaStore.getOrFetchMetadataByPath(entry.path);
  const duration = Number(metadata?.duration);
  return Number.isFinite(duration) && duration > 0 ? secondsToUs(duration) : undefined;
}

async function addToTimeline() {
  if (!selectedFiles.value.length || isAdding.value) return;
  isAdding.value = true;

  try {
    if (props.isReplaceMode && uiStore.mediaReplaceTarget) {
      const entry = selectedFiles.value[0];
      if (entry?.path) {
        timelineStore.updateClipProperties(
          uiStore.mediaReplaceTarget.trackId,
          uiStore.mediaReplaceTarget.itemId,
          { source: { path: entry.path } },
        );
        uiStore.mediaReplaceTarget = null;
        uiStore.isMediaReplaceModalOpen = false;
      }
    } else {
      const selectionKind = captureSelectionKind();
      const addedKinds: ('video' | 'audio')[] = [];

      // The selection is single-type (see isSelectableEntry), so resolve the target track once and
      // lay the clips back-to-back starting at the playhead, advancing by each clip's duration.
      let targetTrackId: string | null = null;
      let cursorUs = timelineStore.currentTime;

      for (const entry of selectedFiles.value) {
        if (!entry.path) continue;
        const mediaType = getMediaTypeFromFilename(entry.name);
        const durationUs = await resolveInsertDurationUs(entry, mediaType);
        const kind = mediaType === 'audio' ? 'audio' : 'video';

        if (targetTrackId === null) {
          targetTrackId = timelineStore.resolveMobileTargetTrackId(kind, { durationUs });
        }

        if (mediaType === 'timeline') {
          await timelineStore.addTimelineClipToTimelineFromPath({
            trackId: targetTrackId,
            name: entry.name,
            path: entry.path,
            startUs: cursorUs,
            pseudo: true,
          });
          cursorUs += durationUs ?? 0;
          continue;
        }

        const targetTrack = timelineStore.timelineDoc?.tracks.find(
          (track) => track.id === targetTrackId,
        );

        if (!targetTrack || !validateMediaTrackCompatibility(mediaType, targetTrack.kind)) {
          toast.add({
            title: t('videoEditor.timeline.mediaTypeNotSupportedOnTrack'),
            color: 'warning',
          });
          continue;
        }

        try {
          const result = await timelineStore.addClipToTimelineFromPath({
            trackId: targetTrackId,
            name: entry.name,
            path: entry.path,
            startUs: cursorUs,
            pseudo: true,
          });
          if (result.warnings?.some((w) => w.type === 'clipTrimmed')) {
            toast.add({
              title: t('fastcat.timeline.clipTrimmedToFitGap'),
              color: 'warning',
              icon: 'i-heroicons-exclamation-triangle',
            });
          }
          cursorUs += result.durationUs ?? durationUs ?? 0;
          addedKinds.push(kind);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'cannot_insert_on_clip') {
            toast.add({
              title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
              color: 'error',
              icon: 'i-heroicons-x-circle',
            });
          } else {
            toast.add({
              title: t('common.error'),
              description: message,
              color: 'error',
            });
          }
        }
      }

      notifyRedirect(selectionKind, addedKinds);
    }

    selectedFiles.value = [];
    emit('added');
    emit('close');
  } catch (error) {
    log.error('addToTimeline / replace failed', error);
  } finally {
    isAdding.value = false;
  }
}

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    selectedFiles.value = [];
    void loadAll(true);
  },
);
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :title="t('fastcat.timeline.fromProjectFiles')"
    :show-close="false"
    :snap-points="[0.85]"
  >
    <div class="relative flex h-full flex-col bg-ui-bg text-ui-text">
      <div
        class="flex shrink-0 items-center justify-between gap-2 border-b border-ui-border/60 bg-ui-bg px-4 py-2"
      >
        <UiButtonGroup
          v-model="assetStore.sortOption.field"
          :options="sortFieldOptions"
          size="xs"
          active-color="primary"
          active-variant="solid"
          variant="ghost"
          color="neutral"
          class="min-w-0"
        />
        <UButton
          :icon="
            assetStore.sortOption.order === 'asc'
              ? 'lucide:arrow-up-narrow-wide'
              : 'lucide:arrow-down-wide-narrow'
          "
          size="sm"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          @click="toggleSortOrder"
        />
      </div>

      <MobileAssetCategoryList
        class="pb-24"
        :categories="visibleCategories"
        :selected-entries="selectedFiles"
        :is-selection-mode="true"
        :is-collapsed="isCollapsed"
        :is-pulling="isPulling"
        :is-refreshing="isRefreshing"
        :pull-distance="pullDistance"
        @entry-click="handleToggleSelection"
        @toggle-selection="handleToggleSelection"
        @toggle-collapse="toggleCollapse"
        @retry="categories.find((category) => category.id === $event)?.load(true)"
        @touch-start="onTouchStart"
        @touch-move="onTouchMove"
        @touch-end="onTouchEnd"
      />

      <div
        v-if="selectedFiles.length"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ui-bg via-ui-bg/95 to-transparent px-4 pb-6 pt-12"
      >
        <UButton
          block
          size="lg"
          color="primary"
          variant="solid"
          :loading="isAdding"
          icon="lucide:plus"
          class="pointer-events-auto rounded-2xl font-bold shadow-lg shadow-primary-500/30 active:scale-[0.98] transition-all"
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
