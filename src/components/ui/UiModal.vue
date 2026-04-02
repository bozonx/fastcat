<script setup lang="ts">
/**
 * Unified Modal Component
 *
 * Provides a consistent layout with header, body, and footer across the application.
 * Wraps @nuxt/ui's UModal and provides standard padding and styling.
 */

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
    title?: string;
    description?: string;
    close?: string;
    [key: string]: unknown;
  };
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  closeButton: true,
  preventClose: false,
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { default: false });
const contentRef = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  (e: 'after:enter'): void;
}>();

const { t } = useI18n();

const modalUi = computed(() => {
  return {
    content: `bg-ui-bg-elevated shadow-xl overflow-hidden rounded-[var(--radius-ui-lg)] border border-ui-border flex flex-col max-h-[90vh] min-h-0 w-full ${props.ui?.content || ''}`,
    header: `px-4 py-3 border-b border-ui-border flex items-center justify-between shrink-0 ${props.ui?.header || ''}`,
    body: `px-4 py-4 w-full overflow-y-auto flex-auto custom-scrollbar ${props.ui?.body || ''}`,
    footer: `px-4 py-3 bg-ui-bg border-t border-ui-border flex justify-end gap-2 shrink-0 ${props.ui?.footer || ''}`,
    title: `text-base font-semibold text-ui-text truncate ${props.ui?.title || ''}`,
    description: `mt-1 text-sm text-ui-text-muted ${props.ui?.description || ''}`,
    close: `-mr-2 ml-4 ${props.ui?.close || ''}`,
    ...props.ui,
  } as Record<string, unknown>;
});

const modalContent = {
  onOpenAutoFocus: (event: Event) => {
    event.preventDefault();
  },
};

function isFocusableElement(element: HTMLElement) {
  if (element.hasAttribute('disabled')) {
    return false;
  }

  if (element.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  return element.tabIndex >= 0;
}

function focusPreferredElement() {
  const container = contentRef.value;
  if (!container) {
    return;
  }

  const target = container.querySelector<HTMLElement>('[data-primary-focus="true"], [autofocus]');

  if (!target || !isFocusableElement(target)) {
    return;
  }

  nextTick(() => {
    setTimeout(() => {
      target.focus();
    }, 0);
  });
}

function handleAfterEnter() {
  focusPreferredElement();
  emit('after:enter');
}

function handleClose() {
  isOpen.value = false;
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :content="modalContent"
    :dismissible="!props.preventClose"
    :title="props.title"
    :description="props.description"
    :aria-describedby="!props.description ? (null as any) : undefined"
    :close="props.closeButton"
    :ui="modalUi as any"
    @after:enter="handleAfterEnter"
  >
    <template v-if="$slots.header" #header>
      <div class="flex items-center justify-between w-full">
        <div class="min-w-0 flex-1">
          <slot name="header" />
        </div>
        <UButton
          v-if="props.closeButton"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-x-mark"
          class="-mr-2 ml-4"
          size="sm"
          :aria-label="t('common.close')"
          @click="handleClose"
        />
      </div>
    </template>

    <template #body>
      <div ref="contentRef" class="w-full h-full">
        <slot />
      </div>
    </template>

    <template v-if="$slots.footer" #footer>
      <div class="flex w-full justify-end gap-3">
        <slot name="footer" />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
@reference "tailwindcss";
</style>
