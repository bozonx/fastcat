<script setup lang="ts">
import { computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { useMediaStore } from '~/stores/media.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { canCopyBloggerDogEntry, canCutBloggerDogEntry } from '~/utils/bloggerdog-file-manager';

const props = defineProps<{
  selectedEntries: FsEntry[];
  canAddToTimeline: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: FileAction, entries: FsEntry[] | FsEntry): void;
  (e: 'add-to-timeline'): void;
}>();

const { t } = useI18n();
const proxyStore = useProxyStore();
const mediaStore = useMediaStore();

const hasVideo = computed(() =>
  props.selectedEntries.some(
    (entry) => entry.kind === 'file' && getMediaTypeFromFilename(entry.name) === 'video',
  ),
);

const hasProxy = computed(() =>
  props.selectedEntries.some(
    (entry) => entry.kind === 'file' && Boolean(entry.path) && proxyStore.existingProxies.has(entry.path),
  ),
);

const isGeneratingProxy = computed(() =>
  props.selectedEntries.some(
    (entry) =>
      entry.kind === 'file' && Boolean(entry.path) && proxyStore.generatingProxies.has(entry.path),
  ),
);

const canExtractAudio = computed(() =>
  props.selectedEntries.some((entry) => {
    if (entry.kind !== 'file' || !entry.path) return false;
    if (getMediaTypeFromFilename(entry.name) !== 'video') return false;
    return Boolean(mediaStore.mediaMetadata[entry.path]?.audio);
  }),
);

const canCopySelection = computed(() =>
  props.selectedEntries.length > 0 &&
  props.selectedEntries.every((entry) => canCopyBloggerDogEntry(entry)),
);

const canCutSelection = computed(() =>
  props.selectedEntries.length > 0 &&
  props.selectedEntries.every((entry) => canCutBloggerDogEntry(entry)),
);
</script>

<template>
  <div class="border-t border-zinc-800 bg-zinc-900 flex flex-col z-40 shrink-0 pb-safe container-safe">
    <MobileDrawerToolbar>
      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        :label="t('common.delete')"
        @click="emit('action', 'delete', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="selectedEntries.length === 1"
        icon="i-heroicons-pencil-square"
        :label="t('common.rename')"
        @click="emit('action', 'rename', props.selectedEntries[0]!)"
      />

      <MobileDrawerToolbarButton
        v-if="canCopySelection"
        icon="i-heroicons-document-duplicate"
        :label="t('common.copy')"
        @click="emit('action', 'copy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="canCutSelection"
        icon="i-heroicons-scissors"
        :label="t('common.cut')"
        @click="emit('action', 'cut', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="hasVideo && !isGeneratingProxy"
        icon="i-heroicons-film"
        :label="t('videoEditor.fileManager.actions.createProxy')"
        @click="emit('action', 'createProxy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="isGeneratingProxy"
        icon="i-heroicons-x-circle"
        :label="t('videoEditor.fileManager.actions.cancelProxyGeneration')"
        @click="emit('action', 'cancelProxy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="hasProxy"
        icon="i-heroicons-trash"
        :label="t('videoEditor.fileManager.actions.deleteProxy')"
        @click="emit('action', 'deleteProxy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="canExtractAudio"
        icon="i-heroicons-musical-note"
        :label="t('videoEditor.fileManager.actions.extractAudio')"
        @click="emit('action', 'extractAudio', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="canAddToTimeline"
        success
        icon="lucide:plus"
        :label="t('common.toTimeline')"
        @click="emit('add-to-timeline')"
      />
    </MobileDrawerToolbar>
  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
