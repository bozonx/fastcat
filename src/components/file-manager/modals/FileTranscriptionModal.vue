<script setup lang="ts">
import type { FsEntry } from '~/types/fs';

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });
const transcriptionLanguage = defineModel<string>('transcriptionLanguage', { default: '' });

const props = withDefaults(
  defineProps<{
    isTranscribing: boolean;
    transcriptionError: string | null;
    transcriptionEntry?: FsEntry | null;
  }>(),
  {
    transcriptionEntry: null,
  },
);

const emit = defineEmits<{
  (e: 'submit'): void;
}>();
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
          v-model="transcriptionLanguage"
          :disabled="props.isTranscribing"
          placeholder="en"
          full-width
        >
          <template v-if="transcriptionLanguage" #trailing>
            <UButton
              color="neutral"
              variant="link"
              icon="i-heroicons-x-mark-20-solid"
              size="2xs"
              :padded="false"
              @click="transcriptionLanguage = ''"
            />
          </template>
        </UiTextInput>
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
        <UButton
          ref="submitButtonRef"
          color="primary"
          :loading="props.isTranscribing"
          autofocus
          @click="emit('submit')"
        >
          {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
