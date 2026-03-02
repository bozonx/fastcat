<script setup lang="ts">
import FilePreview from '~/components/preview/FilePreview.vue';

const { t } = useI18n();

const props = defineProps<{
  selectedEntryKind?: 'file' | 'directory' | null;
  isOtio: boolean;
  isUnknown: boolean;
  currentUrl: string | null;
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'unknown' | null;
  textContent: string;
  filePath?: string;
}>();
</script>

<template>
  <div
    v-if="props.selectedEntryKind === 'file' && !props.isOtio"
    class="w-full bg-ui-bg rounded border border-ui-border flex flex-col min-h-50 overflow-hidden shrink-0"
    :class="
      props.mediaType === 'text'
        ? 'justify-start items-start text-left'
        : 'items-center justify-center'
    "
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

    <div v-else class="w-full h-64">
      <FilePreview
        :url="props.currentUrl"
        :media-type="props.mediaType"
        :text-content="props.textContent"
        :file-path="props.filePath"
      />
    </div>
  </div>
</template>
