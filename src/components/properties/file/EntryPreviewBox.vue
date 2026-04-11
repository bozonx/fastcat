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
  thumbnailUrl?: string | null;
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
      String($attrs.class ?? '').indexOf('flex-1') !== -1 ? 'flex-1' : 'shrink-0',
    ]"
  >
    <div
      v-if="props.selectedEntryKind === 'directory'"
      class="flex flex-col items-center gap-3 text-ui-text-muted w-full h-full justify-center"
      :class="props.thumbnailUrl ? 'p-0' : 'p-8'"
    >
      <div v-if="props.thumbnailUrl" class="w-full h-64 bg-black/20 flex items-center justify-center overflow-hidden">
        <img :src="props.thumbnailUrl" class="max-w-full max-h-full object-contain" />
      </div>
      <UIcon v-else name="i-heroicons-folder" class="w-16 h-16" />
      <p v-if="props.fileName && !props.thumbnailUrl" class="text-sm font-medium text-center truncate w-full px-4">
        {{ props.fileName }}
      </p>
    </div>

    <div
      v-else-if="props.isOtio"
      class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
    >
      <UIcon name="i-heroicons-queue-list" class="w-16 h-16" />
      <p class="text-sm font-medium text-center truncate w-full px-4">
        {{ props.fileName || t('fastcat.timeline.project') }}
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
            : t('fastcat.preview.unsupported')
        }}
      </p>
    </div>

    <!-- No loading state here to avoid flickering. While properties are loading, nothing should happen in the UI. -->
    <div
      v-else-if="!props.mediaType"
      class="w-full h-full min-h-12"
    ></div>


    <div
      v-else
      class="w-full h-64"
      :class="String($attrs.class ?? '').indexOf('flex-1') !== -1 ? 'flex-1 h-full' : 'h-64'"
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
