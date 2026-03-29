<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const isOpen = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  sttTranscribing: boolean;
  sttTranscriptionError: string;
  sttTranscriptionEntry: FsEntry | null;
  sttTranscriptionLanguage: string;
}>();

const emit = defineEmits<{
  (e: 'update:sttTranscriptionLanguage', value: string): void;
  (e: 'submit'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
    :close-button="!props.sttTranscribing"
    :prevent-close="props.sttTranscribing"
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

      <div v-if="props.sttTranscriptionEntry" class="text-xs text-ui-text-muted break-all">
        {{ props.sttTranscriptionEntry.name }}
      </div>

      <UiFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
        <UiTextInput
          :model-value="props.sttTranscriptionLanguage"
          :disabled="props.sttTranscribing"
          placeholder="en"
          full-width
          @update:model-value="emit('update:sttTranscriptionLanguage', $event)"
        />
      </UiFormField>

      <div v-if="props.sttTranscriptionError" class="text-sm text-error-400">
        {{ props.sttTranscriptionError }}
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="props.sttTranscribing"
          @click="isOpen = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          :loading="props.sttTranscribing"
          autofocus
          @click="emit('submit')"
        >
          {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
