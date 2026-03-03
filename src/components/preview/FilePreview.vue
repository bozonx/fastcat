<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import MediaPlayer from '~/components/MediaPlayer.vue';
import ImageViewer from '~/components/preview/ImageViewer.vue';
import TextEditor from '~/components/preview/TextEditor.vue';

const { t } = useI18n();

const props = defineProps<{
  url?: string | null;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | null;
  textContent?: string;
  alt?: string;
  filePath?: string;
  fileName?: string;
}>();

const isFullscreenOpen = ref(false);

function openFullscreen() {
  isFullscreenOpen.value = true;
}

function closeFullscreen() {
  isFullscreenOpen.value = false;
}

function toggleFullscreen() {
  isFullscreenOpen.value = !isFullscreenOpen.value;
}

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreenOpen.value) {
    isFullscreenOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEsc);
  window.addEventListener('gran-preview-fullscreen', openFullscreen);
  window.addEventListener('gran-preview-fullscreen-close', closeFullscreen);
  window.addEventListener('gran-preview-fullscreen-toggle', toggleFullscreen);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleEsc);
  window.removeEventListener('gran-preview-fullscreen', openFullscreen);
  window.removeEventListener('gran-preview-fullscreen-close', closeFullscreen);
  window.removeEventListener('gran-preview-fullscreen-toggle', toggleFullscreen);
});
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <ImageViewer
      v-if="props.mediaType === 'image' && props.url"
      :src="props.url"
      :alt="props.alt"
      class="w-full h-full"
      @open-modal="isFullscreenOpen = true"
    />

    <MediaPlayer
      v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url"
      :src="props.url"
      :type="props.mediaType"
      class="w-full h-full"
      @open-modal="isFullscreenOpen = true"
    />

    <TextEditor
      v-else-if="props.mediaType === 'text'"
      :file-path="props.filePath || ''"
      :file-name="props.fileName"
      :initial-content="props.textContent || ''"
      class="w-full h-full"
    />

    <div
      v-else-if="props.mediaType === 'unknown'"
      class="flex flex-col items-center justify-center h-full w-full gap-3 text-ui-text-muted p-8 bg-ui-bg"
    >
      <UIcon name="i-heroicons-document" class="w-16 h-16" />
      <p class="text-sm text-center">
        {{ t('granVideoEditor.preview.unsupported', 'Unsupported file format for visual preview') }}
      </p>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition opacity-200 duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition opacity-200 duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isFullscreenOpen"
          class="fixed inset-0 bg-black/95 flex flex-col items-center justify-center backdrop-blur-sm"
          style="z-index: 40;"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-heroicons-x-mark"
            class="absolute top-4 right-4 text-white hover:bg-white/20"
            size="xl"
            style="z-index: 41;"
            @click="isFullscreenOpen = false"
          />
          <ImageViewer
            v-if="props.mediaType === 'image' && props.url"
            :src="props.url"
            :alt="props.alt"
            is-modal
            class="w-full h-full flex-1"
            @close-modal="isFullscreenOpen = false"
          />
          <MediaPlayer
            v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url"
            :src="props.url"
            :type="props.mediaType"
            is-modal
            class="w-full h-full flex-1 pb-8"
            @close-modal="isFullscreenOpen = false"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
