<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';

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
  <UiModal v-model:open="isOpen" :title="props.fileName" :ui="{ content: 'max-w-4xl h-[80vh]' }">
    <div class="flex flex-col h-full min-h-0 pt-2">
      <textarea
        v-model="content"
        class="flex-1 w-full resize-none font-mono text-sm text-ui-text bg-ui-bg focus:outline-none p-4 rounded border border-ui-border"
        spellcheck="false"
      />
    </div>
  </UiModal>
</template>
