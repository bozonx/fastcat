<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';

const props = withDefaults(
  defineProps<{
    fileName?: string;
    isSaving: boolean;
    saveError: string | null;
    lastSavedAt: Date | null;
  }>(),
  {
    fileName: 'Text Editor',
  },
);

const isOpen = defineModel<boolean>('open', { default: false });
const content = defineModel<string>('content', { default: '' });
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="props.fileName"
    :restore-focus="false"
    :ui="{ content: 'max-w-4xl h-[80vh]' }"
  >
    <div class="flex flex-col h-full min-h-0 pt-2">
      <UiTextarea
        v-model="content"
        class="flex-1"
        variant="none"
        :ui="{
          root: 'ring-0 focus-within:ring-0',
          base: 'h-full resize-none font-mono ring-0 focus:ring-0 border border-ui-border focus:outline-none focus-visible:outline-none text-editor-textarea',
        }"
        :spellcheck="false"
        data-primary-focus="true"
        full-width
      />
    </div>
  </UiModal>
</template>
