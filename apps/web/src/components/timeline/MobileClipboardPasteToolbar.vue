<script setup lang="ts">
import { computed } from 'vue';
import { useAppClipboard } from '~/composables/useAppClipboard';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';

const emit = defineEmits<{
  (e: 'paste'): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const clipboardStore = useAppClipboard();

const timelinePayload = computed(() => {
  const payload = clipboardStore.clipboardPayload;
  return payload?.source === 'timeline' ? payload : null;
});
</script>

<template>
  <div class="border-t border-ui-border bg-ui-bg-elevated z-40 container-safe pb-safe shrink-0">
    <div
      class="px-4 py-1.5 text-[10px] font-medium text-ui-text-muted uppercase tracking-wider border-b border-ui-border/50"
    >
      {{ timelinePayload?.operation === 'cut' ? t('common.cut') : t('common.copied') }}:
      {{ timelinePayload?.items.length ?? 0 }}
    </div>
    <MobileDrawerToolbar>
      <MobileDrawerToolbarButton
        icon="i-heroicons-clipboard-document-check"
        :label="t('common.paste')"
        @click="emit('paste')"
      />
      <MobileDrawerToolbarButton
        icon="i-heroicons-x-mark"
        :label="t('common.cancel')"
        @click="emit('cancel')"
      />
    </MobileDrawerToolbar>
  </div>
</template>
