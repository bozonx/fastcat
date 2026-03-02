<script setup lang="ts">
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
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <ImageViewer
      v-if="props.mediaType === 'image' && props.url"
      :src="props.url"
      :alt="props.alt"
      class="w-full h-full"
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
  </div>
</template>
