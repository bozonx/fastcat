<script setup lang="ts">
import MediaPlayer from '~/components/MediaPlayer.vue';

const { t } = useI18n();

const props = defineProps<{
  selectedEntryKind?: 'file' | 'directory' | null;
  isOtio: boolean;
  isUnknown: boolean;
  currentUrl: string | null;
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'unknown' | null;
  textContent: string;
}>();
</script>

<template>
  <div
    v-if="props.selectedEntryKind === 'file' && !props.isOtio"
    class="w-full bg-ui-bg rounded border border-ui-border flex flex-col min-h-50 overflow-hidden shrink-0"
    :class="props.mediaType === 'text' ? 'justify-start items-start text-left' : 'items-center justify-center'"
  >
    <div
      v-if="props.isUnknown && !props.isOtio"
      class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
    >
      <UIcon name="i-heroicons-document" class="w-16 h-16" />
      <p class="text-sm text-center">
        {{ t('granVideoEditor.preview.unsupported', 'Unsupported file format for visual preview') }}
      </p>
    </div>

    <div v-else-if="props.currentUrl" class="w-full h-full flex flex-col">
      <div
        v-if="props.mediaType === 'image' || props.mediaType === 'video'"
        class="w-full h-64 flex items-center justify-center checkerboard-bg"
      >
        <img
          v-if="props.mediaType === 'image'"
          :src="props.currentUrl"
          class="max-w-full max-h-64 object-contain"
        />
        <MediaPlayer
          v-else
          :src="props.currentUrl"
          :type="props.mediaType"
          class="w-full h-64"
        />
      </div>
      <MediaPlayer
        v-else-if="props.mediaType === 'audio'"
        :src="props.currentUrl"
        :type="props.mediaType"
        class="w-full h-64"
      />
    </div>

    <pre
      v-else-if="props.mediaType === 'text'"
      class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-ui-text whitespace-pre-wrap"
      >{{ props.textContent }}</pre
    >
  </div>
</template>

<style scoped>
.checkerboard-bg {
  background-color: #1a1a1a;
  background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.15) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.15) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}
</style>
