<script setup lang="ts">
const props = defineProps<{
  latestTranscriptionCacheKey: string;
  latestTranscriptionWasCached: boolean;
  latestTranscriptionText: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="props.latestTranscriptionCacheKey" class="flex flex-wrap gap-2 pt-1">
      <span class="text-xs text-ui-text-muted self-center">
        {{
          props.latestTranscriptionWasCached
            ? t('videoEditor.fileManager.audio.transcriptionCached', 'Loaded from cache')
            : t('videoEditor.fileManager.audio.transcriptionSaved', 'Saved to cache')
        }}
      </span>
    </div>

    <UTextarea
      v-if="props.latestTranscriptionText"
      :model-value="props.latestTranscriptionText"
      :rows="8"
      readonly
    />
  </div>
</template>
