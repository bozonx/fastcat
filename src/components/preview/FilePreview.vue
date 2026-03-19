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
const isTextModalOpen = ref(false);
const {
  isFullscreen,
  toggle: toggleFullscreen,
  exit: exitFullscreen,
} = useFullscreen(containerRef);

watch(
  () => uiStore.previewFullscreenToggleTrigger,
  (timestamp) => {
    if (!timestamp) return;
    if (props.mediaType === 'text') {
      isTextModalOpen.value = !isTextModalOpen.value;
    } else if (props.mediaType !== 'audio') {
      void toggleFullscreen();
    }
  },
);

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isFullscreen.value) {
      void exitFullscreen();
      e.stopPropagation();
    } else if (isTextModalOpen.value) {
      isTextModalOpen.value = false;
      e.stopPropagation();
    }
  }
}

watch([isFullscreen, isTextModalOpen], ([fs, tm], [oldFs, oldTm]) => {
  const nowOpen = fs || tm;
  const wasOpen = oldFs || oldTm;
  if (nowOpen && !wasOpen) {
    uiStore.activeModalsCount++;
  } else if (!nowOpen && wasOpen) {
    uiStore.activeModalsCount--;
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleEsc, { capture: true });
});

onUnmounted(() => {
  if (isFullscreen.value || isTextModalOpen.value) {
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
    <template v-if="props.mediaType === 'image' && props.url">
      <div
        :class="isFullscreen ? 'flex-1 flex flex-col items-center justify-center' : 'w-full h-full'"
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
          @open-modal="props.mediaType !== 'audio' && toggleFullscreen()"
          @close-modal="exitFullscreen"
        />
      </div>
    </template>

    <TextEditor
      v-else-if="props.mediaType === 'text'"
      v-model:is-modal-open="isTextModalOpen"
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
