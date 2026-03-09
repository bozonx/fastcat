<script setup lang="ts">
import { watch, ref, computed, onUnmounted } from 'vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { PanelFocusId } from '~/stores/focus.store';

const props = defineProps<{
  filePath: string;
  mediaType: 'video' | 'audio' | 'image' | 'unknown' | null;
  focusPanelId?: PanelFocusId;
}>();

const currentUrl = ref<string | null>(null);
const fileManager = useFileManager();

const fileName = computed(() => {
  if (!props.filePath) return undefined;
  const parts = props.filePath.split('/');
  return parts[parts.length - 1];
});

async function loadPreviewMedia() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }

  if (!props.filePath) return;

  try {
    const fileToPlay = await fileManager.vfs.getFile(props.filePath);
    if (!fileToPlay) return;
    if (props.mediaType === 'image' || props.mediaType === 'video' || props.mediaType === 'audio') {
      currentUrl.value = URL.createObjectURL(fileToPlay);
    }
  } catch (e) {
    console.error('Failed to load media for panel:', e);
  }
}

watch(() => props.filePath, loadPreviewMedia, { immediate: true });

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});
</script>

<template>
  <div class="h-full w-full flex items-center justify-center bg-ui-bg-elevated relative">
    <EntryPreviewBox
      selected-entry-kind="file"
      :is-otio="false"
      :is-unknown="props.mediaType === 'unknown'"
      :current-url="currentUrl"
      :media-type="props.mediaType"
      :text-content="''"
      :file-path="props.filePath"
      :file-name="fileName"
      :focus-panel-id="props.focusPanelId"
      class="border-none w-full h-full flex-1 max-h-full min-h-0 absolute inset-0"
    />
  </div>
</template>

<style scoped>
:deep(.w-full.h-64) {
  height: 100% !important;
  max-height: 100% !important;
}
</style>
