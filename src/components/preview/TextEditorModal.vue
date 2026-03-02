<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';

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
  <AppModal
    v-model:open="isOpen"
    :title="props.fileName"
    :ui="{ content: 'max-w-4xl h-[80vh]' }"
  >
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between px-1 py-2 text-xs shrink-0">
        <span class="text-ui-text-muted">Autosave enabled</span>
        <span v-if="props.isSaving" class="text-ui-text">Saving...</span>
        <span v-else-if="props.saveError" class="text-red-400">{{ props.saveError }}</span>
        <span v-else-if="props.lastSavedAt" class="text-ui-text-muted">
          Saved at
          {{ props.lastSavedAt?.toLocaleTimeString?.() || '' }}
        </span>
        <span v-else class="text-ui-text-muted">No changes</span>
      </div>

      <textarea
        v-model="content"
        class="flex-1 w-full resize-none font-mono text-sm text-ui-text bg-ui-bg focus:outline-none p-4 rounded border border-ui-border"
        spellcheck="false"
      />
    </div>
  </AppModal>
</template>
