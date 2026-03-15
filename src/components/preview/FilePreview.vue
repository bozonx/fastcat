<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useFullscreen } from '@vueuse/core';
import MediaPlayer from '~/components/MediaPlayer.vue';
import ImageViewer from '~/components/preview/ImageViewer.vue';
import TextEditor from '~/components/preview/TextEditor.vue';
import { useUiStore } from '~/stores/ui.store';
import type { PanelFocusId } from '~/stores/focus.store';

const { t } = useI18n();
const uiStore = useUiStore();

const props = defineProps<{
  url?: string | null;
  mediaType: 'video' | 'audio' | 'image' | 'text' | 'unknown' | null;
  textContent?: string;
  alt?: string;
  filePath?: string;
  fileName?: string;
  focusPanelId?: PanelFocusId;
}>();

const containerRef = ref<HTMLElement | null>(null);
const { isFullscreen, toggle: toggleFullscreen, exit: exitFullscreen } = useFullscreen(containerRef);

watch(
  () => uiStore.previewFullscreenToggleTrigger,
  (timestamp) => {
    if (timestamp) {
      void toggleFullscreen();
    }
  },
);

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    void exitFullscreen();
    e.stopPropagation();
  }
}

watch(isFullscreen, (val, oldVal) => {
  if (val && !oldVal) {
    uiStore.activeModalsCount++;
  } else if (!val && oldVal) {
    uiStore.activeModalsCount--;
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleEsc, { capture: true });
});

onUnmounted(() => {
  if (isFullscreen.value) {
    uiStore.activeModalsCount--;
  }
  window.removeEventListener('keydown', handleEsc, { capture: true });
});
</script>

<template>
  <div
    ref="containerRef"
    class="w-full h-full flex flex-col overflow-hidden relative group/preview"
    :class="{ 'bg-black': isFullscreen }"
  >
    <UButton
      v-if="isFullscreen"
      color="neutral"
      variant="ghost"
      icon="i-heroicons-x-mark"
      class="absolute top-4 right-4 text-white hover:bg-white/20 z-50 transition-opacity opacity-0 group-hover/preview:opacity-100"
      size="xl"
      @click="exitFullscreen"
    />

    <template v-if="props.mediaType === 'image' && props.url">
      <div
        :class="
          isFullscreen
            ? 'flex-1 flex flex-col items-center justify-center'
            : 'w-full h-full'
        "
      >
        <ImageViewer
          :src="props.url"
          :alt="props.alt"
          :is-modal="isFullscreen"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="toggleFullscreen"
          @close-modal="exitFullscreen"
        />
      </div>
    </template>

    <template v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url">
      <div
        :class="
          isFullscreen
            ? 'flex-1 flex flex-col items-center justify-center pb-8'
            : 'w-full h-full flex flex-col min-h-0'
        "
      >
        <MediaPlayer
          :src="props.url"
          :type="props.mediaType"
          :is-modal="isFullscreen"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="toggleFullscreen"
          @close-modal="exitFullscreen"
        />
      </div>
    </template>

    <TextEditor
      v-else-if="props.mediaType === 'text'"
      :file-path="props.filePath || ''"
      :file-name="props.fileName"
      :initial-content="props.textContent || ''"
      :focus-panel-id="props.focusPanelId"
      class="w-full h-full"
    />

    <div
      v-else-if="props.mediaType === 'unknown'"
      class="flex flex-col items-center justify-center h-full w-full gap-3 text-ui-text-muted p-8 bg-ui-bg"
    >
      <UIcon name="i-heroicons-document" class="w-16 h-16" />
      <p class="text-sm text-center">
        {{ t('fastcat.preview.unsupported', 'Unsupported file format for visual preview') }}
      </p>
    </div>
  </div>
</template>

