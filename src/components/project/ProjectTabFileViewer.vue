<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useProxyStore } from '~/stores/proxy.store';
import FilePreview from '~/components/preview/FilePreview.vue';

const props = defineProps<{
  filePath: string;
  fileName: string;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | null;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const proxyStore = useProxyStore();

const currentUrl = ref<string | null>(null);
const textContent = ref<string>('');
const isLoading = ref(false);
const loadError = ref<string | null>(null);

const isText = computed(() => props.mediaType === 'text');
const isImage = computed(() => props.mediaType === 'image');
const isVideo = computed(() => props.mediaType === 'video');
const isAudio = computed(() => props.mediaType === 'audio');
const isUnknown = computed(() => props.mediaType === 'unknown' || props.mediaType === null);

async function loadFile() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }
  textContent.value = '';
  loadError.value = null;

  if (!props.filePath) return;

  isLoading.value = true;
  try {
    const handle = await projectStore.getFileHandleByPath(props.filePath);
    if (!handle) {
      loadError.value = 'File not found';
      return;
    }

    const file = await handle.getFile();

    if (isText.value) {
      const slice = file.slice(0, 1024 * 1024);
      textContent.value = await slice.text();
      if (file.size > 1024 * 1024) textContent.value += '\n... (truncated)';
      return;
    }

    if (isImage.value || isVideo.value || isAudio.value) {
      // Try proxy for video/audio
      if ((isVideo.value || isAudio.value) && props.filePath) {
        const proxyFile = await proxyStore.getProxyFile(props.filePath).catch(() => null);
        if (proxyFile) {
          currentUrl.value = URL.createObjectURL(proxyFile);
          return;
        }
      }
      currentUrl.value = URL.createObjectURL(file);
    }
  } catch (e) {
    console.error('ProjectTabFileViewer: failed to load file:', e);
    loadError.value = 'Failed to load file';
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.filePath, loadFile, { immediate: true });

onUnmounted(() => {
  if (currentUrl.value) URL.revokeObjectURL(currentUrl.value);
});
</script>

<template>
  <div class="flex flex-col h-full w-full overflow-hidden bg-ui-bg-elevated">
    <!-- Loading -->
    <div
      v-if="isLoading"
      class="flex items-center justify-center h-full text-ui-text-muted text-sm"
    >
      <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin mr-2" />
      {{ t('common.loading') }}
    </div>

    <!-- Error -->
    <div
      v-else-if="loadError"
      class="flex flex-col items-center justify-center h-full gap-2 text-red-400 text-sm"
    >
      <UIcon name="i-heroicons-exclamation-triangle" class="w-8 h-8" />
      <span>{{ loadError }}</span>
    </div>

    <!-- Preview -->
    <FilePreview
      v-else
      :url="currentUrl"
      :media-type="mediaType"
      :text-content="textContent"
      :file-path="filePath"
      :file-name="fileName"
      :alt="fileName"
    />
  </div>
</template>
