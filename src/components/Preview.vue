<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';

const { t } = useI18n();
const uiStore = useUiStore();

const currentUrl = ref<string | null>(null);
const mediaType = ref<'image' | 'video' | 'audio' | 'unknown' | null>(null);

watch(
  () => uiStore.selectedFsEntry,
  async (entry) => {
    // Revoke old URL
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }
    mediaType.value = null;

    if (!entry || entry.kind !== 'file') return;

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

      if (file.type.startsWith('image/')) {
        mediaType.value = 'image';
      } else if (file.type.startsWith('video/')) {
        mediaType.value = 'video';
      } else if (file.type.startsWith('audio/')) {
        mediaType.value = 'audio';
      } else {
        mediaType.value = 'unknown';
        return;
      }

      currentUrl.value = URL.createObjectURL(file);
    } catch (e) {
      console.error('Failed to preview file:', e);
    }
  },
);

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});

const isUnknown = computed(() => mediaType.value === 'unknown');
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0">
    <!-- Header -->
    <div class="flex items-center px-3 py-2 border-b border-ui-border shrink-0 h-10">
      <span class="text-xs font-semibold text-ui-text-muted uppercase tracking-wider">
        {{ t('granVideoEditor.preview.title', 'Preview') }}
      </span>
      <span v-if="uiStore.selectedFsEntry" class="ml-2 text-xs text-gray-500 font-mono truncate">
        {{ uiStore.selectedFsEntry.name }}
      </span>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 flex items-center justify-center bg-black relative">
      <div v-if="!uiStore.selectedFsEntry" class="flex flex-col items-center gap-3 text-gray-700">
        <UIcon name="i-heroicons-eye" class="w-16 h-16" />
        <p class="text-sm">
          {{ t('granVideoEditor.preview.noFile', 'No file selected') }}
        </p>
      </div>

      <div v-else-if="isUnknown" class="flex flex-col items-center gap-3 text-gray-700">
        <UIcon name="i-heroicons-document" class="w-16 h-16" />
        <p class="text-sm">
          {{ t('granVideoEditor.preview.unsupported', 'Unsupported file format') }}
        </p>
      </div>

      <template v-else-if="currentUrl">
        <img
          v-if="mediaType === 'image'"
          :src="currentUrl"
          class="max-w-full max-h-full object-contain"
        />
        <MediaPlayer
          v-else-if="mediaType === 'video' || mediaType === 'audio'"
          :src="currentUrl"
          :type="mediaType"
          class="w-full h-full"
        />
      </template>
    </div>
  </div>
</template>
