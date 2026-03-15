<script setup lang="ts">
const props = defineProps<{
  canTranscribeMedia: boolean;
  latestTranscriptionCacheKey: string;
  latestTranscriptionWasCached: boolean;
  latestTranscriptionText: string;
  openTranscriptionModal: () => void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap gap-2 pt-1">
      <UButton
        size="xs"
        color="primary"
        variant="soft"
        icon="i-heroicons-microphone"
        :disabled="!props.canTranscribeMedia"
        @click="props.openTranscriptionModal"
      >
        {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
      </UButton>
      <span v-if="props.latestTranscriptionCacheKey" class="text-xs text-ui-text-muted self-center">
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
