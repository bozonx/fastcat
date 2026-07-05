<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    text?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
    openOnClick?: boolean;
  }>(),
  {
    text: '',
    placement: 'top',
    disabled: false,
    openOnClick: false,
  },
);

const tooltipId = useId();
const hoverOpen = ref(false);
const focusOpen = ref(false);
const pinnedOpen = ref(false);
const root = ref<HTMLElement | null>(null);

const hasTooltip = computed(() => Boolean(props.text && !props.disabled));
const isOpen = computed(
  () => hasTooltip.value && (hoverOpen.value || focusOpen.value || pinnedOpen.value),
);

function openHover() {
  if (hasTooltip.value) hoverOpen.value = true;
}

function closeHover() {
  hoverOpen.value = false;
}

function openFocus() {
  if (hasTooltip.value) focusOpen.value = true;
}

function closeFocus() {
  focusOpen.value = false;
}

function closePinned() {
  pinnedOpen.value = false;
  globalThis.document?.removeEventListener('pointerdown', onDocumentPointerDown, true);
}

function onDocumentPointerDown(event: PointerEvent) {
  if (root.value?.contains(event.target as Node)) return;
  closePinned();
}

function togglePinned() {
  if (!hasTooltip.value || !props.openOnClick) return;

  pinnedOpen.value = !pinnedOpen.value;

  if (pinnedOpen.value) {
    globalThis.document?.addEventListener('pointerdown', onDocumentPointerDown, true);
    return;
  }

  globalThis.document?.removeEventListener('pointerdown', onDocumentPointerDown, true);
}

function closeAll() {
  hoverOpen.value = false;
  focusOpen.value = false;
  closePinned();
}

onBeforeUnmount(() => {
  globalThis.document?.removeEventListener('pointerdown', onDocumentPointerDown, true);
});
</script>

<template>
  <UTooltip
    :open="isOpen"
    :disabled="!hasTooltip"
    :content="{ side: placement, sideOffset: 8, collisionPadding: 8 }"
    :delay-duration="0"
    :ui="{
      content:
        'h-auto min-h-6 max-w-xs whitespace-pre-line border border-ui-border bg-ui-bg-elevated px-2.5 py-1.5 text-left leading-snug text-ui-text shadow-xl',
    }"
  >
    <span
      ref="root"
      class="inline-flex [&>*]:flex-1 [&>*]:min-w-0"
      :aria-describedby="isOpen ? tooltipId : undefined"
      @pointerenter="openHover"
      @pointerleave="closeHover"
      @focusin="openFocus"
      @focusout="closeFocus"
      @click="togglePinned"
      @keydown.esc.stop="closeAll"
    >
      <slot />
    </span>

    <template #content>
      <span :id="tooltipId">{{ text }}</span>
    </template>
  </UTooltip>
</template>
