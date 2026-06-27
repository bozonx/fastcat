<script setup lang="ts">
import { useLongPressTooltip } from '~/composables/ui/useLongPressTooltip';

type ButtonColor =
  | 'primary'
  | 'secondary'
  | 'neutral'
  | 'error'
  | 'warning'
  | 'success'
  | 'info'
  // Custom color aliases registered in app.config.ts
  | 'red'
  | 'green'
  | 'amber'
  | 'blue'
  | 'yellow';
type ButtonSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type ButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';

const props = withDefaults(
  defineProps<{
    size?: ButtonSize;
    variant?: ButtonVariant;
    color?: ButtonColor;
    icon?: string;
    label?: string;
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    square?: boolean;
    hoverClass?: string;
    title?: string;
    disableMobileTooltip?: boolean;
  }>(),
  {
    size: 'sm',
    variant: 'ghost',
    color: 'neutral',
    icon: undefined,
    label: undefined,
    loading: false,
    disabled: false,
    block: false,
    square: false,
    hoverClass: 'hover:bg-ui-bg-hover/60 hover:text-ui-text transition-colors',
    title: undefined,
    disableMobileTooltip: false,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const { tooltipText, tooltipVisible, tooltipX, tooltipY, startPress, movePress, hide } =
  useLongPressTooltip();

let isTouchActive = false;

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'touch') {
    isTouchActive = true;
    if (!props.disableMobileTooltip && props.title) {
      startPress(e, props.title);
    }
  } else {
    isTouchActive = false;
  }
}

function onPointerUp() {
  isTouchActive = false;
  hide();
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType === 'touch') {
    if (!props.disableMobileTooltip) {
      movePress(e);
    }
  }
}

function onPointerLeave() {
  isTouchActive = false;
  hide();
}

function onPointerCancel() {
  isTouchActive = false;
  hide();
}

function onContextMenu(e: Event) {
  if (isTouchActive) {
    e.preventDefault();
  }
}

function onClick(event: MouseEvent) {
  if (props.disabled || props.loading) return;
  (event.currentTarget as HTMLElement).blur();
  emit('click', event);
}
</script>

<template>
  <UButton
    v-bind="$attrs"
    :size="size"
    :variant="variant"
    :color="color"
    :icon="icon"
    :label="label"
    :loading="loading"
    :disabled="disabled"
    :title="title"
    :class="[hoverClass, block ? 'w-full' : '', square ? 'aspect-square p-0' : '']"
    @click="onClick"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointercancel="onPointerCancel"
    @contextmenu="onContextMenu"
  >
    <slot />
  </UButton>

  <Teleport to="body">
    <div
      v-if="tooltipVisible"
      class="fixed z-[9999] px-2.5 py-1.5 rounded-lg bg-black/90 text-white text-xs font-medium whitespace-nowrap pointer-events-none shadow-lg"
      :style="{ left: `${tooltipX}px`, top: `${tooltipY - 48}px`, transform: 'translateX(-50%)' }"
    >
      {{ tooltipText }}
    </div>
  </Teleport>
</template>
