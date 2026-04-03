<script setup lang="ts">
import FilePreview from '~/components/preview/FilePreview.vue';
import type { PanelFocusId } from '~/stores/focus.store';

const { t } = useI18n();

const props = defineProps<{
  selectedEntryKind?: 'file' | 'directory' | null;
  isOtio: boolean;
  isUnknown: boolean;
  isCorrupt?: boolean;
  currentUrl: string | null;
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'unknown' | null;
  textContent: string;
  filePath?: string;
  fileName?: string;
  focusPanelId?: PanelFocusId;
}>();
</script>

<template>
  <div
    v-if="props.selectedEntryKind === 'file' || props.selectedEntryKind === 'directory'"
    class="w-full bg-ui-bg rounded border border-ui-border flex flex-col min-h-12 overflow-hidden"
    :class="[
      props.mediaType === 'text' && !props.isOtio
        ? 'justify-start items-start text-left'
        : 'items-center justify-center',
      $attrs.class?.includes('flex-1') ? 'flex-1' : 'shrink-0',
    ]"
  >
    <div
      v-if="props.selectedEntryKind === 'directory'"
      class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
    >
      <UIcon name="i-heroicons-folder" class="w-16 h-16" />
      <p v-if="props.fileName" class="text-sm font-medium text-center truncate w-full px-4">
        {{ props.fileName }}
      </p>
    </div>

    <div
      v-else-if="props.isOtio"
      class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
    >
      <UIcon name="i-heroicons-queue-list" class="w-16 h-16" />
      <p class="text-sm font-medium text-center truncate w-full px-4">
        {{ props.fileName || t('fastcat.timeline.project', 'Timeline Project') }}
      </p>
    </div>

    <div
      v-else-if="props.isUnknown || props.isCorrupt"
      class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
    >
      <UIcon
        :name="props.isCorrupt ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-document'"
        class="w-16 h-16"
        :class="props.isCorrupt ? 'text-red-400' : ''"
      />
      <p class="text-sm text-center font-medium" :class="props.isCorrupt ? 'text-red-400' : ''">
        {{
          props.isCorrupt
            ? t('videoEditor.fileManager.compatibility.corruptTitle')
            : t('fastcat.preview.unsupported', 'Unsupported file format for visual preview')
        }}
      </p>
    </div>

    <div
      v-else
      class="w-full h-64"
      :class="$attrs.class?.includes('flex-1') ? 'flex-1 h-full' : 'h-64'"
    >
      <FilePreview
        :url="props.currentUrl"
        :media-type="props.mediaType"
        :text-content="props.textContent"
        :file-path="props.filePath"
        :file-name="props.fileName"
        :focus-panel-id="props.focusPanelId"
      />
    </div>
  </div>
</template>
