<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useReplaceMediaFileManagerStore } from '~/stores/file-manager.store';
import {
  FILE_MANAGER_INJECTION_KEY,
  useFileManager,
} from '~/composables/file-manager/useFileManager';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import { useI18n } from 'vue-i18n';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';

const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const mediaStore = useMediaStore();
const toast = useToast();
const { t } = useI18n();

const replaceStore = useReplaceMediaFileManagerStore();
const replaceFileManager = useFileManager({ shouldRecordFileManagerHistory: () => false });
provide(FILE_MANAGER_INJECTION_KEY, replaceFileManager);
provide('fileManagerStore', replaceStore);

const route = useRoute();
const isMobileLayout = computed(() => route.path === '/m' || route.path.startsWith('/m/'));

const projectStore = useProjectStore();

const isOpen = computed({
  get: () => uiStore.isMediaReplaceModalOpen && !isMobileLayout.value,
  set: (val) => {
    uiStore.isMediaReplaceModalOpen = val;
  },
});

const allowedMediaTypes = computed(() => {
  const target = uiStore.mediaReplaceTarget;
  return target ? target.expectedType : undefined;
});

const currentSourcePath = computed(() => {
  const target = uiStore.mediaReplaceTarget;
  if (!target) return null;

  const clip = timelineStore.timelineDoc?.tracks
    .find((track) => track.id === target.trackId)
    ?.items.find((item) => item.id === target.itemId);

  return clip && 'source' in clip ? clip.source?.path : null;
});

const excludedPaths = computed(() => (currentSourcePath.value ? [currentSourcePath.value] : []));
const selectedFileEntry = ref<FsEntry | null>(null);

watch(isOpen, (newVal) => {
  if (newVal) {
    selectedFileEntry.value = null;

    // Clear selection for replace-modal instance to avoid leftover selections
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager' && selected.instanceId === 'replace-modal') {
      selectionStore.clearSelection();
    }

    // Open project root directory
    replaceStore.openFolder(
      {
        kind: 'directory',
        name: projectStore.currentProjectName || 'Project',
        path: '',
        source: 'local',
      },
      { skipSelection: true },
    );
  }
});

const isReplaceModalFileSelected = computed(() => selectedFileEntry.value?.kind === 'file');

function handlePickerSelect(entry: FsEntry | null) {
  selectedFileEntry.value = entry?.kind === 'file' ? entry : null;
}

async function handleSelectFile(entry: FsEntry) {
  if (entry.kind !== 'file' || !entry.path) return;
  const target = uiStore.mediaReplaceTarget;
  if (!target) return;

  const mType = getMediaTypeFromFilename(entry.name);
  if (!target.expectedType.includes(mType as any)) {
    // optional: show toast or handle invalid selection
    return;
  }

  const track = timelineStore.timelineDoc?.tracks.find((track) => track.id === target.trackId);
  if (track?.kind === 'audio') {
    const metadata = await mediaStore.getOrFetchMetadataByPath(entry.path);
    if (!metadata || !metadata.audio) {
      toast.add({
        color: 'error',
        title: t('common.error'),
        description: t('fastcat.timeline.noAudioTrackInVideo'),
      });
      return;
    }
  }

  // Update clip source
  timelineStore.updateClipProperties(target.trackId, target.itemId, {
    source: { path: entry.path },
  });

  uiStore.mediaReplaceTarget = null;
  uiStore.isMediaReplaceModalOpen = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.clip.replaceMedia')"
    :ui="{ width: 'max-w-4xl sm:max-w-6xl', height: 'h-[80vh]' }"
  >
    <div class="h-full relative overflow-hidden bg-ui-bg">
      <FileBrowser
        instance-id="replace-modal"
        hide-actions
        hide-upload
        prevent-open
        hide-toolbar
        single-click-folders
        disable-marquee
        isolated-selection
        hide-usage-indicators
        hide-corrupt-files
        :allowed-media-types="allowedMediaTypes"
        :excluded-paths="excludedPaths"
        @select="handlePickerSelect"
      />
      <div
        v-if="isReplaceModalFileSelected && selectedFileEntry"
        class="absolute bottom-4 right-4 z-10"
      >
        <UButton
          icon="i-heroicons-check"
          color="primary"
          size="lg"
          @click="handleSelectFile(selectedFileEntry)"
        >
          {{ t('fastcat.clip.replaceMedia') }}
        </UButton>
      </div>
    </div>
  </UiModal>
</template>
