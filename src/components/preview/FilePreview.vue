<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
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

const isFullscreenOpen = ref(false);

function toggleFullscreen() {
  isFullscreenOpen.value = !isFullscreenOpen.value;
}

watch(
  () => uiStore.previewFullscreenToggleTrigger,
  (timestamp) => {
    if (timestamp) {
      toggleFullscreen();
    }
  },
);

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreenOpen.value) {
    isFullscreenOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEsc);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleEsc);
});
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden relative">
    <Teleport to="body" :disabled="!isFullscreenOpen">
      <div
        v-if="isFullscreenOpen"
        class="fixed inset-0 bg-black/95 backdrop-blur-sm pointer-events-none"
        style="z-index: 40"
      ></div>

      <div
        v-if="props.mediaType === 'image' && props.url"
        :class="
          isFullscreenOpen
            ? 'fixed inset-0 flex flex-col items-center justify-center'
            : 'w-full h-full'
        "
        style="z-index: 41"
      >
        <UButton
          v-if="isFullscreenOpen"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-x-mark"
          class="absolute top-4 right-4 text-white hover:bg-white/20 z-42"
          size="xl"
          @click="isFullscreenOpen = false"
        />
        <ImageViewer
          :src="props.url"
          :alt="props.alt"
          :is-modal="isFullscreenOpen"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="isFullscreenOpen = true"
          @close-modal="isFullscreenOpen = false"
        />
      </div>

      <div
        v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url"
        :class="
          isFullscreenOpen
            ? 'fixed inset-0 flex flex-col items-center justify-center z-41 pb-8'
            : 'w-full h-full flex flex-col min-h-0'
        "
      >
        <UButton
          v-if="isFullscreenOpen"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-x-mark"
          class="absolute top-4 right-4 text-white hover:bg-white/20 z-42"
          size="xl"
          @click="isFullscreenOpen = false"
        />
        <MediaPlayer
          :src="props.url"
          :type="props.mediaType"
          :is-modal="isFullscreenOpen"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="isFullscreenOpen = true"
          @close-modal="isFullscreenOpen = false"
        />
      </div>

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
          {{
            t('granVideoEditor.preview.unsupported', 'Unsupported file format for visual preview')
          }}
        </p>
      </div>
    </Teleport>
  </div>
</template>
