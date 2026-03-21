<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import MediaPlayer from '~/components/media/MediaPlayer.vue';
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

const isMediaModalOpen = ref(false);
const isTextModalOpen = ref(false);

function openMediaModal() {
  isMediaModalOpen.value = true;
}

function closeMediaModal() {
  isMediaModalOpen.value = false;
}

watch(
  () => uiStore.previewFullscreenToggleTrigger,
  (timestamp) => {
    if (!timestamp) return;
    if (props.mediaType === 'text') {
      isTextModalOpen.value = !isTextModalOpen.value;
    } else if (props.mediaType !== 'audio') {
      isMediaModalOpen.value = !isMediaModalOpen.value;
    }
  },
);

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (isMediaModalOpen.value) {
      isMediaModalOpen.value = false;
      e.stopPropagation();
    } else if (isTextModalOpen.value) {
      isTextModalOpen.value = false;
      e.stopPropagation();
    }
  }
}

watch([isMediaModalOpen, isTextModalOpen], ([mm, tm], [oldMm, oldTm]) => {
  const nowOpen = mm || tm;
  const wasOpen = oldMm || oldTm;
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
  if (isMediaModalOpen.value || isTextModalOpen.value) {
    uiStore.activeModalsCount--;
  }
  window.removeEventListener('keydown', handleEsc, { capture: true });
});
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden relative group/preview">
    <template v-if="props.mediaType === 'image' && props.url">
      <div class="w-full h-full">
        <ImageViewer
          :src="props.url"
          :alt="props.alt"
          :is-modal="false"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="openMediaModal"
          @close-modal="closeMediaModal"
        />
      </div>
    </template>

    <template v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url">
      <div class="w-full h-full flex flex-col min-h-0">
        <MediaPlayer
          :src="props.url"
          :type="props.mediaType"
          :is-modal="false"
          :focus-panel-id="props.focusPanelId"
          class="w-full h-full"
          @open-modal="props.mediaType !== 'audio' && openMediaModal()"
          @close-modal="closeMediaModal"
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

  <!-- Window-modal for image/video fullscreen preview -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isMediaModalOpen"
        class="fixed inset-0 z-[var(--z-max)] flex items-center justify-center bg-black/90"
        @click.self="closeMediaModal"
      >
        <div class="relative w-full h-full flex flex-col">
          <!-- Close button -->
          <div class="absolute top-3 right-3 z-10">
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-x-mark"
              class="bg-black/40 hover:bg-black/60"
              @click="closeMediaModal"
            />
          </div>

          <template v-if="props.mediaType === 'image' && props.url">
            <ImageViewer
              :src="props.url"
              :alt="props.alt"
              :is-modal="true"
              :focus-panel-id="props.focusPanelId"
              class="w-full h-full"
              @close-modal="closeMediaModal"
            />
          </template>

          <template v-else-if="props.mediaType === 'video' && props.url">
            <MediaPlayer
              :src="props.url"
              type="video"
              :is-modal="true"
              :focus-panel-id="props.focusPanelId"
              class="w-full h-full"
              @close-modal="closeMediaModal"
            />
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
