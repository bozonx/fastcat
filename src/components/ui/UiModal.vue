<script setup lang="ts">
import { onBeforeUnmount, ref, computed } from 'vue';
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
  /** Whether to restore focus to the trigger element when closed */
  restoreFocus?: boolean;
  /** Target element selector/id or boolean to configure teleporting */
  portal?: boolean | string;
  /** Nuxt UI modal configuration */
  ui?: {
    overlay?: string;
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
  restoreFocus: true,
  portal: true,
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { default: false });
const contentRef = ref<HTMLElement | null>(null);
const footerRef = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  (e: 'after:enter'): void;
}>();

const { t } = useI18n();
let cleanupOutsideClickSuppression: (() => void) | null = null;

const modalUi = computed(() => {
  const userUi = props.ui ?? {};

  return {
    ...userUi,
    overlay: `z-[var(--z-modal-backdrop)] ${String(userUi.overlay || '')}`.trim(),
    content:
      `z-[var(--z-modal)] bg-ui-bg-elevated shadow-xl overflow-hidden rounded-[var(--radius-ui-lg)] border border-ui-border flex flex-col max-h-[90vh] min-h-0 w-[calc(100%-2rem)] sm:w-full ${userUi.content || ''}`.trim(),
    header: `px-4 py-3 border-b border-ui-border flex items-center justify-between shrink-0 select-none ${userUi.header || ''}`,
    body: `px-4 py-4 w-full overflow-y-auto flex-auto custom-scrollbar ${userUi.body || ''}`,
    footer: `px-4 py-3 bg-ui-bg border-t border-ui-border flex justify-end gap-2 shrink-0 ${userUi.footer || ''}`,
    title: `text-base font-semibold text-ui-text truncate select-none ${userUi.title || ''}`,
    description: `mt-1 text-sm text-ui-text-muted ${userUi.description || ''}`,
    close: `-mr-2 ml-4 ${userUi.close || ''}`,
  } as Record<string, string | undefined>;
});

const modalContent = {
  onOpenAutoFocus: (event: Event) => {
    const focused = focusPreferredElement();
    if (focused) {
      event.preventDefault();
    }
  },
  onPointerDownOutside: (event: Event) => {
    suppressNextOutsideClick(event);
  },
  onCloseAutoFocus: (event: Event) => {
    if (props.restoreFocus === false) {
      event.preventDefault();
    }
  },
};

interface PointerDownOutsideEvent extends Event {
  detail?: {
    originalEvent?: PointerEvent;
  };
}

function isFocusableElement(element: HTMLElement) {
  if (element.hasAttribute('disabled')) {
    return false;
  }

  if (element.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  return element.tabIndex >= 0;
}

function focusPreferredElement(): boolean {
  const bodyContainer = contentRef.value;
  const footerContainer = footerRef.value;

  let target: HTMLElement | null = null;

  if (bodyContainer) {
    target = bodyContainer.querySelector<HTMLElement>('[data-primary-focus="true"], [autofocus]');
  }

  if (!target && footerContainer) {
    target = footerContainer.querySelector<HTMLElement>('[data-primary-focus="true"], [autofocus]');
  }

  if (!target || !isFocusableElement(target)) {
    return false;
  }

  target.focus();
  return true;
}

function suppressNextOutsideClick(event: Event) {
  if (props.preventClose) {
    return;
  }

  const originalEvent = (event as PointerDownOutsideEvent).detail?.originalEvent;
  if (!originalEvent) {
    return;
  }

  cleanupOutsideClickSuppression?.();

  const onClick = (clickEvent: MouseEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    clickEvent.stopImmediatePropagation();
    cleanupOutsideClickSuppression?.();
  };
  const timeoutId = window.setTimeout(() => {
    cleanupOutsideClickSuppression?.();
  }, 250);

  cleanupOutsideClickSuppression = () => {
    document.removeEventListener('click', onClick, true);
    window.clearTimeout(timeoutId);
    cleanupOutsideClickSuppression = null;
  };

  document.addEventListener('click', onClick, true);
}

function handleAfterEnter() {
  emit('after:enter');
}

function handleClose() {
  isOpen.value = false;
}

onBeforeUnmount(() => {
  cleanupOutsideClickSuppression?.();
});
</script>

<template>
  <UModal
    v-model:open="isOpen"
    scrollable
    :content="modalContent"
    :dismissible="!props.preventClose"
    :title="props.title"
    :description="props.description"
    :aria-describedby="props.description ? undefined : 'undefined'"
    :close="props.closeButton"
    :portal="props.portal"
    :ui="modalUi"
    @close="handleClose"
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
      <div ref="footerRef" class="flex w-full justify-end gap-3">
        <slot name="footer" />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
@reference "tailwindcss";
</style>
