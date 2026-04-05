<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
  isTranscriptionModalOpen: boolean;
  transcriptionLanguage: string;
  isTranscribingAudio: boolean;
  transcriptionError: string | null;
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

const submitButtonRef = ref<any>(null);

function focusSubmitButton() {
  const el = submitButtonRef.value?.$el || submitButtonRef.value;
  if (!(el instanceof HTMLElement)) {
    return;
  }

  nextTick(() => {
    setTimeout(() => {
      el.focus();
    }, 0);
  });
}

const handleAfterEnter = () => {
  focusSubmitButton();
};

watch(
  () => props.isTranscriptionModalOpen,
  (newValue) => {
    if (newValue) {
      focusSubmitButton();
    }
  },
);
</script>

<template>
  <UiModal
    :open="props.isTranscriptionModalOpen"
    :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
    :close-button="!props.isTranscribingAudio"
    :prevent-close="props.isTranscribingAudio"
    :ui="{ content: 'sm:max-w-lg', body: 'overflow-y-auto' }"
    @update:open="onModalUpdate"
    @after:enter="handleAfterEnter"
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

      <UiFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
        <UiTextInput
          :model-value="props.transcriptionLanguage"
          :disabled="props.isTranscribingAudio"
          placeholder="en"
          full-width
          @update:model-value="onLanguageUpdate"
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
          :disabled="props.isTranscribingAudio"
          @click="onModalUpdate(false)"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          ref="submitButtonRef"
          color="primary"
          :loading="props.isTranscribingAudio"
          autofocus
          @click="onSubmit"
        >
          {{ t('videoEditor.fileManager.audio.transcriptionSubmit', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
