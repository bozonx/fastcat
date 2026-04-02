<script setup lang="ts">
import { useClipboardStore } from '~/stores/clipboard.store';

const emit = defineEmits<{
  (e: 'paste'): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const clipboardStore = useClipboardStore();
</script>

<template>
  <div class="border-t border-zinc-800 bg-zinc-900 p-3 flex items-center justify-between z-40">
    <div class="text-sm font-medium">
      {{
        clipboardStore.clipboardPayload?.operation === 'cut'
          ? t('common.cut', 'Cut')
          : t('common.copied', 'Copied')
      }}: {{ clipboardStore.clipboardPayload?.items.length }}
    </div>
    <div class="flex gap-2">
      <UButton
        size="sm"
        color="neutral"
        variant="soft"
        :label="t('common.cancel', 'Cancel')"
        @click="emit('cancel')"
      />
      <UButton
        size="sm"
        color="primary"
        :label="t('common.paste', 'Paste')"
        @click="emit('paste')"
      />
    </div>
  </div>
</template>
