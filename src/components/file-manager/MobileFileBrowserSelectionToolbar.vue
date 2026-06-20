<script setup lang="ts">
import { computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { normalizeMediaCachePath } from '~/utils/media-cache-path';
import { canCopyBloggerDogEntry, canCutBloggerDogEntry } from '~/utils/bloggerdog-file-manager';
import { getMediaTypeFromFilename } from '~/utils/media-types';

const props = defineProps<{
  selectedEntries: FsEntry[];
  canAddToTimeline: boolean;
  hideClipboardActions?: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: FileAction, entries: FsEntry[] | FsEntry): void;
  (e: 'add-to-timeline'): void;
  (e: 'cancel-selection'): void;
}>();

const { t } = useI18n();
const proxyStore = useProxyStore();

const hasVideo = computed(() =>
  props.selectedEntries.some(
    (entry) => entry.kind === 'file' && getMediaTypeFromFilename(entry.name) === 'video',
  ),
);

const hasProxy = computed(() =>
  props.selectedEntries.some(
    (entry) =>
      entry.kind === 'file' &&
      Boolean(entry.path) &&
      proxyStore.existingProxies.has(normalizeMediaCachePath(entry.path)),
  ),
);

const isGeneratingProxy = computed(() =>
  props.selectedEntries.some(
    (entry) =>
      entry.kind === 'file' &&
      Boolean(entry.path) &&
      proxyStore.generatingProxies.has(normalizeMediaCachePath(entry.path)),
  ),
);

const canCopySelection = computed(
  () =>
    props.selectedEntries.length > 0 &&
    props.selectedEntries.every((entry) => canCopyBloggerDogEntry(entry)),
);

const canCutSelection = computed(
  () =>
    props.selectedEntries.length > 0 &&
    props.selectedEntries.every((entry) => canCutBloggerDogEntry(entry)),
);
</script>

<template>
  <div
    class="border-t border-ui-border bg-ui-bg-elevated flex flex-row items-center z-40 shrink-0 pb-safe container-safe"
  >
    <MobileDrawerToolbar class="flex-1 min-w-0">
      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        @click="emit('action', 'delete', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="!hideClipboardActions && canCopySelection"
        icon="i-heroicons-document-duplicate"
        @click="emit('action', 'copy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="!hideClipboardActions && canCutSelection"
        icon="i-heroicons-scissors"
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
        v-if="canAddToTimeline"
        success
        icon="lucide:plus"
        :label="t('common.toTimeline')"
        @click="emit('add-to-timeline')"
      />
    </MobileDrawerToolbar>

    <!-- Close / deselect button pinned to the right -->
    <UButton
      icon="lucide:x"
      color="neutral"
      variant="ghost"
      size="sm"
      class="shrink-0 mx-1"
      @click="emit('cancel-selection')"
    />
  </div>
</template>
