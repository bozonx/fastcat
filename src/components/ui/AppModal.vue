<script setup lang="ts">
/**
 * Unified Modal Component
 *
 * Provides a consistent layout with header, body, and footer across the application.
 * Wraps @nuxt/ui's UModal and provides standard padding and styling.
 */

import { DialogTitle, DialogDescription } from 'reka-ui';

interface Props {
  /** Title of the modal */
  title?: string;
  /** Optional description text below the title */
  description?: string;
  /** Whether to show the close button in the top right corner */
  closeButton?: boolean;
  /** Whether to prevent closing when clicking outside or pressing ESC */
  preventClose?: boolean;
  /** Nuxt UI modal configuration */
  ui?: {
    content?: string;
    body?: string;
    header?: string;
    footer?: string;
    [key: string]: unknown;
  };
}

const props = withDefaults(defineProps<Props>(), {
  closeButton: true,
  preventClose: false,
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const modalUi = computed(() => {
  return props.ui || {};
});

const headerClass = computed(() => {
  return props.ui?.header;
});

const bodyClass = computed(() => {
  return props.ui?.body;
});

const footerClass = computed(() => {
  return props.ui?.footer;
});

function handleClose(close?: () => void) {
  if (close) {
    close();
    return;
  }
  isOpen.value = false;
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :dismissible="!props.preventClose"
    :title="props.title"
    :description="props.description"
    :ui="modalUi"
  >
    <template #content="{ close }">
      <div
        class="bg-ui-bg-elevated shadow-xl overflow-hidden sm:rounded-2xl border border-ui-border flex flex-col max-h-[90vh] min-h-0 w-full"
        :class="modalUi.content"
      >
        <!-- Header -->
        <div
          v-if="props.title || $slots.header || props.closeButton"
          class="px-6 py-4 border-b border-ui-border flex items-center justify-between shrink-0"
          :class="headerClass"
        >
          <div class="min-w-0 flex-1">
            <slot name="header">
              <DialogTitle v-if="props.title" class="text-lg font-semibold text-ui-text truncate">
                {{ props.title }}
              </DialogTitle>
              <DialogDescription
                :class="[props.description ? 'mt-1 text-sm text-ui-text-muted' : 'sr-only']"
              >
                {{ props.description || props.title || 'Modal' }}
              </DialogDescription>
            </slot>
          </div>

          <UButton
            v-if="props.closeButton"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-x-mark"
            class="-mr-2 ml-4"
            size="md"
            :aria-label="t('common.close')"
            @click="handleClose(close)"
          />
        </div>

        <!-- Body -->
        <div class="px-6 py-6 w-full overflow-y-auto flex-auto custom-scrollbar" :class="bodyClass">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="px-6 py-4 bg-ui-bg border-t border-ui-border flex justify-end gap-3 shrink-0"
          :class="footerClass"
        >
          <slot name="footer" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
@reference "tailwindcss";

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 9999px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
</style>
