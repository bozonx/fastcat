<script setup lang="ts">
import { useClipboardStore } from '~/stores/clipboard.store';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';

const emit = defineEmits<{
  (e: 'paste'): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const clipboardStore = useClipboardStore();
</script>

<template>
  <div class="border-t border-zinc-800 bg-zinc-900 z-40 container-safe pb-safe shrink-0">
    <div class="px-4 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800/50">
      {{
        clipboardStore.clipboardPayload?.operation === 'cut'
          ? t('common.cut', 'Cut')
          : t('common.copied', 'Copied')
      }}: {{ clipboardStore.clipboardPayload?.items.length }}
    </div>
    <MobileDrawerToolbar>
      <MobileDrawerToolbarButton
        icon="i-heroicons-clipboard-document-check"
        :label="t('common.paste', 'Paste')"
        @click="emit('paste')"
      />
      <MobileDrawerToolbarButton
        icon="i-heroicons-x-mark"
        :label="t('common.cancel', 'Cancel')"
        @click="emit('cancel')"
      />
    </MobileDrawerToolbar>
  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
