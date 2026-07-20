<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { useLongPressTooltip } from '~/composables/ui/useLongPressTooltip';

interface Props {
  icon: string;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  success?: boolean;
  primary?: boolean;
  status?: 'muted' | 'solo' | 'locked' | 'hidden' | 'disabled';
  /** Show an integrated corner chevron affordance that opens a variants sheet via `@chevron` (or long press). */
  withChevron?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ click: []; chevron: [] }>();

const { t } = useI18n();

const { tooltipText, tooltipVisible, tooltipX, tooltipY, startPress, movePress, hide } =
  useLongPressTooltip();

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let isLongPressTriggered = false;
let startX = 0;
let startY = 0;

function clearLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onPointerDown(e: PointerEvent) {
  isLongPressTriggered = false;
  if (props.disabled) return;

  startX = e.clientX;
  startY = e.clientY;
  clearLongPress();

  if (props.withChevron) {
    longPressTimer = setTimeout(() => {
      isLongPressTriggered = true;
      hide();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch {
          // Ignore vibration error
        }
      }
      emit('chevron');
    }, 350);
  } else if (props.label) {
    startPress(e, props.label);
  }
}

function onPointerMove(e: PointerEvent) {
  movePress(e);
  if (longPressTimer !== null) {
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > 10 || dy > 10) {
      clearLongPress();
    }
  }
}

function onPointerUp() {
  hide();
  clearLongPress();
}

function onClick(e: MouseEvent) {
  if (isLongPressTriggered) {
    e.preventDefault();
    e.stopPropagation();
    isLongPressTriggered = false;
    return;
  }
  if (props.disabled) return;
  emit('click');
}

function onChevronClick(e: Event) {
  e.stopPropagation();
  if (props.disabled) return;
  emit('chevron');
}

onBeforeUnmount(() => {
  clearLongPress();
});
</script>

<template>
  <div class="relative shrink-0">
    <button
      data-vaul-no-drag
      class="mobile-drawer-toolbar-button relative flex items-center justify-center rounded-xl w-11 h-11 shrink-0 transition-all outline-none"
      :class="[
        danger
          ? 'text-red-400 bg-red-400/10'
          : success
            ? 'text-white bg-ui-action border-none shadow-lg shadow-ui-action/20'
            : primary
              ? 'text-white bg-blue-500 border-none shadow-lg shadow-blue-500/20'
              : active
                ? status === 'muted'
                  ? 'text-white bg-red-500 border-none shadow-lg shadow-red-500/20'
                  : status === 'solo'
                    ? 'text-white bg-green-500 border-none shadow-lg shadow-green-500/20'
                    : status === 'locked'
                      ? 'text-white bg-blue-500 border-none shadow-lg shadow-blue-500/20'
                      : status === 'hidden' || status === 'disabled'
                        ? 'text-black bg-white dark:text-black dark:bg-white border-none shadow-lg shadow-white/10'
                        : 'text-blue-400 bg-blue-400/15 border border-blue-500/30'
                : 'text-ui-text bg-ui-bg-muted/50',
        disabled ? 'opacity-40 pointer-events-none' : 'active:scale-95',
      ]"
      :disabled="disabled"
      :title="label"
      :aria-label="label"
      @click="onClick"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointermove="onPointerMove"
      @pointerleave="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu.prevent
    >
      <UIcon :name="icon" class="w-5 h-5 shrink-0" />

      <span
        v-if="withChevron"
        class="absolute bottom-1 right-1 flex items-center justify-center w-3.5 h-3.5 rounded-br-sm text-current opacity-70 transition-opacity"
        :aria-label="`${label ?? ''} — ${t('fastcat.timeline.trimOptions')}`"
        @click.stop="onChevronClick"
      >
        <UIcon name="i-heroicons-chevron-up" class="w-3 h-3" />
      </span>
    </button>
  </div>

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
