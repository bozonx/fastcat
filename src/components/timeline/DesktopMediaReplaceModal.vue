<script setup lang="ts">
import { computed, provide, watch } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useReplaceMediaFileManagerStore } from '~/stores/file-manager.store';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import { useI18n } from 'vue-i18n';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';

const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const { t } = useI18n();

const replaceStore = useReplaceMediaFileManagerStore();
provide('fileManagerStore', replaceStore);

const route = useRoute();
const isMobileLayout = computed(() => route.path === '/m' || route.path.startsWith('/m/'));

const isOpen = computed({
  get: () => uiStore.isMediaReplaceModalOpen && !isMobileLayout.value,
  set: (val) => {
    uiStore.isMediaReplaceModalOpen = val;
  },
});

watch(isOpen, (newVal) => {
  if (newVal) {
    // Clear selection for replace-modal instance to avoid leftover selections
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager' && selected.instanceId === 'replace-modal') {
      selectionStore.clearSelection();
    }
  }
});

const isReplaceModalFileSelected = computed(() => {
  const selected = selectionStore.selectedEntity;
  return (
    selected?.source === 'fileManager' &&
    selected.kind === 'file' &&
    selected.instanceId === 'replace-modal'
  );
});

const selectedFileEntry = computed<FsEntry | null>(() => {
  const selected = selectionStore.selectedEntity;
  if (
    selected?.source === 'fileManager' &&
    selected.kind === 'file' &&
    selected.instanceId === 'replace-modal'
  ) {
    return selected.entry;
  }
  return null;
});

function handleSelectFile(entry: FsEntry) {
  if (entry.kind !== 'file' || !entry.path) return;
  const target = uiStore.mediaReplaceTarget;
  if (!target) return;

  const mType = getMediaTypeFromFilename(entry.name);
  if (mType !== target.expectedType) {
    // optional: show toast or handle invalid selection
    return;
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
      />
      <div v-if="isReplaceModalFileSelected && selectedFileEntry" class="absolute bottom-4 right-4 z-10">
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
