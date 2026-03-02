<script setup lang="ts">
import { ref } from 'vue';
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

const isImageModalOpen = ref(false);
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <ImageViewer
      v-if="props.mediaType === 'image' && props.url"
      :src="props.url"
      :alt="props.alt"
      class="w-full h-full"
      @open-modal="isImageModalOpen = true"
    />

    <MediaPlayer
      v-else-if="(props.mediaType === 'video' || props.mediaType === 'audio') && props.url"
      :src="props.url"
      :type="props.mediaType"
      class="w-full h-full"
    />

    <TextEditor
      v-else-if="props.mediaType === 'text'"
      :file-path="props.filePath || ''"
      :file-name="props.fileName"
      :initial-content="props.textContent || ''"
      class="w-full h-full"
    />

    <div
      v-else
      class="flex flex-col items-center justify-center h-full w-full gap-3 text-ui-text-muted p-8 bg-ui-bg"
    >
      <UIcon name="i-heroicons-document" class="w-16 h-16" />
      <p class="text-sm text-center">
        {{ t('granVideoEditor.preview.unsupported', 'Unsupported file format for visual preview') }}
      </p>
    </div>

    <UModal v-model="isImageModalOpen" fullscreen>
      <div class="w-full h-full relative">
        <UButton
          color="white"
          variant="ghost"
          icon="i-heroicons-x-mark"
          class="absolute top-4 right-4 z-10"
          @click="isImageModalOpen = false"
        />
        <ImageViewer
          v-if="props.mediaType === 'image' && props.url && isImageModalOpen"
          :src="props.url"
          :alt="props.alt"
          is-modal
          class="w-full h-full"
          @close-modal="isImageModalOpen = false"
        />
      </div>
    </UModal>
  </div>
</template>
