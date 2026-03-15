<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';

const props = defineProps<{
  isTranscriptionModalOpen: boolean;
  transcriptionLanguage: string;
  isTranscribingAudio: boolean;
  transcriptionError: string;
}>();

const emit = defineEmits<{
  'update:isTranscriptionModalOpen': [val: boolean];
  'update:transcriptionLanguage': [val: string];
  submit: [];
}>();

const { t } = useI18n();

function onModalUpdate(val: boolean) {
  emit('update:isTranscriptionModalOpen', val);
}

function onLanguageUpdate(val: string) {
  emit('update:transcriptionLanguage', val);
}

function onSubmit() {
  emit('submit');
}
</script>

<template>
  <AppModal
    :open="props.isTranscriptionModalOpen"
    @update:open="onModalUpdate"
    :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
    :close-button="!props.isTranscribingAudio"
    :prevent-close="props.isTranscribingAudio"
    :ui="{ content: 'sm:max-w-lg', body: 'overflow-y-auto' }"
  >
    <div class="flex flex-col gap-4">
      <div class="text-sm text-ui-text-muted">
        {{
          t(
            'videoEditor.fileManager.audio.transcriptionHint',
            'Send the current audio file to the configured STT service. Language is optional.',
          )
        }}
      </div>

      <UFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
        <UInput
          :model-value="props.transcriptionLanguage"
          @update:model-value="onLanguageUpdate"
          :disabled="props.isTranscribingAudio"
          placeholder="en"
        />
      </UFormField>

      <div v-if="props.transcriptionError" class="text-sm text-error-400">
        {{ props.transcriptionError }}
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="props.isTranscribingAudio"
          @click="onModalUpdate(false)"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" :loading="props.isTranscribingAudio" @click="onSubmit">
          {{ t('videoEditor.fileManager.audio.transcriptionSubmit', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
