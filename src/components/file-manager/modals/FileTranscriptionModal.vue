<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const isOpen = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  isTranscribing: boolean;
  transcriptionError: string | null;
  transcriptionEntry: FsEntry | null;
  transcriptionLanguage: string;
}>();

const emit = defineEmits<{
  (e: 'update:transcriptionLanguage', value: string): void;
  (e: 'submit'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
    :close-button="!props.isTranscribing"
    :prevent-close="props.isTranscribing"
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

      <div v-if="props.transcriptionEntry" class="text-xs text-ui-text-muted break-all">
        {{ props.transcriptionEntry.name }}
      </div>

      <UiFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
        <UiTextInput
          :model-value="props.transcriptionLanguage"
          :disabled="props.isTranscribing"
          placeholder="en"
          full-width
          @update:model-value="emit('update:transcriptionLanguage', $event)"
        />
      </UiFormField>

      <div v-if="props.transcriptionError" class="text-sm text-error-400">
        {{ props.transcriptionError }}
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="props.isTranscribing"
          @click="isOpen = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" :loading="props.isTranscribing" autofocus @click="emit('submit')">
          {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
