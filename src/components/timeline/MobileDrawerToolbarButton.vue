<script setup lang="ts">
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
  /** Show a corner chevron affordance that opens a variants sheet via `@chevron`. */
  withChevron?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ click: []; chevron: [] }>();

const { t } = useI18n();

function onChevron(e: Event) {
  e.stopPropagation();
  if (props.disabled) return;
  emit('chevron');
}

const { tooltipText, tooltipVisible, tooltipX, tooltipY, startPress, movePress, hide } =
  useLongPressTooltip();

function onPointerDown(e: PointerEvent) {
  startPress(e, props.label ?? '');
}

function onPointerUp() {
  hide();
}

function onPointerMove(e: PointerEvent) {
  movePress(e);
}

function onPointerLeave() {
  hide();
}
</script>

<template>
  <div class="relative shrink-0">
    <button
      data-vaul-no-drag
      class="mobile-drawer-toolbar-button flex items-center justify-center rounded-xl w-11 h-11 shrink-0 transition-all outline-none"
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
      @click="$emit('click')"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointercancel="onPointerUp"
      @contextmenu.prevent
    >
      <UIcon :name="icon" class="w-5 h-5 shrink-0" />
    </button>

    <button
      v-if="withChevron"
      data-vaul-no-drag
      type="button"
      class="absolute -bottom-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-ui-bg-elevated border border-ui-border shadow-sm text-ui-text-muted active:scale-90 transition-transform"
      :class="disabled ? 'opacity-40 pointer-events-none' : ''"
      :aria-label="`${label ?? ''} — ${t('fastcat.timeline.trimOptions')}`"
      @click="onChevron"
      @pointerdown.stop
      @contextmenu.prevent
    >
      <UIcon name="i-heroicons-chevron-up" class="w-3 h-3" />
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
