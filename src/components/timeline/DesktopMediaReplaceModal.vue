<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';
import { useI18n } from 'vue-i18n';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';

const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const { t } = useI18n();

const route = useRoute();
const isMobileLayout = computed(() => route.path === '/m' || route.path.startsWith('/m/'));

const isOpen = computed({
  get: () => uiStore.isMediaReplaceModalOpen && !isMobileLayout.value,
  set: (val) => {
    uiStore.isMediaReplaceModalOpen = val;
  }
});

const targetType = computed(() => uiStore.mediaReplaceTarget?.expectedType);

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
    source: { path: entry.path }
  });
  
  uiStore.mediaReplaceTarget = null;
  uiStore.isMediaReplaceModalOpen = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.clip.replaceMedia', 'Replace Media')"
    :ui="{ width: 'max-w-4xl sm:max-w-6xl', height: 'h-[80vh]' }"
  >
    <!-- Wait, we can't easily intercept FileBrowser clicks without modifying it. -->
    <div class="h-full relative overflow-hidden bg-ui-bg">
      <FileBrowser 
        instance-id="replace-modal" 
        hide-actions
        hide-upload
      />
      <!-- If we can't intercept click, we can rely on context menu or file browser selection + a confirm button -->
      <div v-if="uiStore.selectedFsEntry?.kind === 'file'" class="absolute bottom-4 right-4 z-10">
        <UButton 
          icon="i-heroicons-check" 
          color="primary" 
          size="lg"
          @click="handleSelectFile(uiStore.selectedFsEntry as FsEntry)"
        >
          {{ t('fastcat.clip.replaceMedia', 'Replace Media') }}
        </UButton>
      </div>
    </div>
  </UiModal>
</template>
