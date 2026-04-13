<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';

interface Props {
  /** Title of the drawer */
  title?: string;
  /** Optional description text below the title */
  description?: string;
  /** Snap points for the drawer (mostly for bottom direction). Can be numbers (0-1) or strings (px). */
  snapPoints?: (number | string)[];
  /** Whether to scale the background when the drawer is open (iOS-style) */
  shouldScaleBackground?: boolean;
  /** Whether the drawer is modal (blocks background interaction) */
  modal?: boolean;
  /** Whether to show the dark overlay backdrop */
  overlay?: boolean;
  /** Whether to show the visual handle at the top */
  withHandle?: boolean;
  /** Whether the drawer can be dismissed by clicking outside or swiping down */
  dismissible?: boolean;
  /** Custom direction override, otherwise auto-detected by orientation */
  direction?: 'bottom' | 'top' | 'left' | 'right';
  /** Whether to take almost full screen height in portrait mode (95dvh) */
  isFullHeight?: boolean;
  /** Whether to show an explicit close button */
  showClose?: boolean;
  /** Custom UI classes for the container */
  ui?: {
    container?: string;
    body?: string;
    header?: string;
    footer?: string;
    toolbar?: string;
    close?: string;
  };
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  snapPoints: undefined,
  shouldScaleBackground: false,
  dismissible: true,
  direction: undefined,
  isFullHeight: false,
  modal: true,
  overlay: true,
  withHandle: true,
  showClose: true,
  ui: () => ({}),
});
const isOpen = defineModel<boolean>('open', { default: false });
const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const { target: effectiveTeleportTarget } = useTeleportTarget();

/**
 * UDrawer (vaul-vue / Reka Dialog) requires DrawerTitle and DrawerDescription inside DrawerContent.
 * With the #content slot, Nuxt UI only injects them when title/description slots or props are set.
 */
const drawerTitleForA11y = computed(() => props.title?.trim() || 'Panel');
const drawerDescriptionForA11y = computed(() => props.description?.trim() || '\u00A0');

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

/**
 * Auto-detect direction based on orientation if not explicitly provided.
 * Mobile best practice: side for landscape, bottom for portrait.
 */
const effectiveDirection = computed(() => {
  if (props.direction) return props.direction;
  return isLandscape.value ? 'right' : 'bottom';
});

/**
 * In non-modal / snapping mode, the drawer is 'expanded' if it's at the last snap point
 * or if it's a side drawer.
 */
const isExpanded = computed(() => {
  if (!props.snapPoints || props.snapPoints.length === 0) return true;
  if (effectiveDirection.value === 'right' || effectiveDirection.value === 'left') return true;
  if (activeSnapPoint.value === null) return false;

  const lastPoint = props.snapPoints[props.snapPoints.length - 1];
  return activeSnapPoint.value === lastPoint;
});

/** Responsive container logic */
const containerClasses = computed(() => {
  const base =
    'flex flex-col relative overflow-hidden shadow-2xl transition-all duration-300 pointer-events-auto z-[var(--z-fixed)] antialiased transform-gpu';
  const bgColor = 'bg-zinc-900/98 backdrop-blur-xl ring-1 ring-white/10';

  if (effectiveDirection.value === 'right' || effectiveDirection.value === 'left') {
    const sideBorder = effectiveDirection.value === 'right' ? 'border-l' : 'border-r';
    return `${base} max-h-dvh h-screen w-[50vw] sm:w-[40vw] ml-auto ${sideBorder} border-zinc-800/80 ${bgColor} ${props.ui.container || ''}`;
  }

  const heightClass = props.isFullHeight ? 'h-[95dvh]' : 'max-h-[85dvh]';
  return `${base} ${heightClass} w-full border-t border-zinc-800/80 ${bgColor} rounded-t-2xl ${props.ui.container || ''}`;
});

const bodyClasses = computed(() => {
  return `flex-1 min-h-0 overflow-y-auto pb-safe custom-scrollbar ${props.ui.body || ''}`;
});

// --- Non-modal Backdrop Logic (for interactive drawers like timeline) ---

const bdStartY = ref(0);
const bdStartX = ref(0);
const bdDy = ref(0);
const bdDx = ref(0);

const isBackdropInteractive = computed(
  () =>
    !props.modal &&
    isOpen.value &&
    isExpanded.value &&
    (effectiveDirection.value === 'bottom' || effectiveDirection.value === 'top'),
);

const bodyRef = ref<HTMLElement | null>(null);

function onBackdropTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  bdStartY.value = t.clientY;
  bdStartX.value = t.clientX;
  bdDy.value = 0;
  bdDx.value = 0;
}

function onBackdropTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  bdDy.value = t.clientY - bdStartY.value;
  bdDx.value = t.clientX - bdStartX.value;
}

function onBackdropTouchEnd(e: TouchEvent) {
  const dy = bdDy.value;
  const adx = Math.abs(bdDx.value);

  if (Math.abs(dy) < 10 && adx < 10) {
    isOpen.value = false;
    return;
  }

  if (dy > 50 && dy > adx * 1.5) {
    e.preventDefault();
    isOpen.value = false;
  }
}

function onBackdropClick() {
  if (!props.modal) isOpen.value = false;
}

function onClose() {
  isOpen.value = false;
}

function onHandleTap() {
  if (isExpanded.value) {
    isOpen.value = false;
    return;
  }

  if (props.snapPoints && props.snapPoints.length > 0) {
    activeSnapPoint.value = props.snapPoints[props.snapPoints.length - 1] as string | number;
    return;
  }

  isOpen.value = true;
}

function onSnapPointChange(val: string | number) {
  activeSnapPoint.value = val;
}

watch(isOpen, (val) => {
  if (!val) {
    activeSnapPoint.value = null;
  } else {
    // Focus management
    nextTick(() => {
      setTimeout(() => {
        if (!bodyRef.value) return;
        const target = bodyRef.value.querySelector<HTMLElement>(
          '[data-primary-focus="true"], [autofocus]',
        );
        if (target) {
          target.focus();
        }
      }, 400); // Wait for transition completion
    });
  }
});
</script>

<template>
  <Teleport v-if="!props.modal" :to="effectiveTeleportTarget">
    <div
      class="fixed inset-0 bg-zinc-950/40 backdrop-blur-[2px] transition-all duration-300 z-[calc(var(--z-fixed)-1)]"
      :class="[
        isOpen && (props.modal || isExpanded) ? 'opacity-100' : 'opacity-0 pointer-events-none',
        props.modal || isBackdropInteractive ? 'pointer-events-auto' : 'pointer-events-none',
      ]"
      :style="{ touchAction: isBackdropInteractive ? 'none' : 'auto' }"
      @touchstart.passive="onBackdropTouchStart"
      @touchmove.passive="onBackdropTouchMove"
      @touchend="onBackdropTouchEnd"
      @click="onBackdropClick"
    />
  </Teleport>

  <UDrawer
    v-model:open="isOpen"
    :direction="effectiveDirection"
    :title="drawerTitleForA11y"
    :description="drawerDescriptionForA11y"
    :snap-points="props.snapPoints"
    :active-snap-point="activeSnapPoint ?? undefined"
    :dismissible="props.dismissible"
    :should-scale-background="props.shouldScaleBackground"
    :modal="props.modal"
    :overlay="props.modal && props.overlay"
    :handle="false"
    :ui="{ content: 'z-[var(--z-fixed)] shadow-none ring-0' }"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <div :class="containerClasses">
        <!-- Vertical mode: drag handle -->
        <div
          v-if="
            (effectiveDirection === 'bottom' || effectiveDirection === 'top') && props.withHandle
          "
          class="shrink-0 relative z-10 cursor-pointer group"
          @click.stop="onHandleTap"
        >
          <div class="flex justify-center py-2.5">
            <div
              class="w-12 h-1.5 rounded-full bg-zinc-700/40 group-hover:bg-zinc-600/60 transition-colors"
            ></div>
          </div>
        </div>

        <!-- Side mode: lateral handle -->
        <div
          v-if="
            (effectiveDirection === 'right' || effectiveDirection === 'left') && props.withHandle
          "
          class="absolute top-0 bottom-0 flex flex-col items-center justify-center pointer-events-none"
          :class="effectiveDirection === 'right' ? 'left-0 w-6' : 'right-0 w-6'"
        >
          <div
            class="w-1 h-12 rounded-full bg-zinc-700/60 cursor-pointer pointer-events-auto"
            @click.stop="onHandleTap"
          />
        </div>

        <!-- Optional Toolbar (stays visible at first snap point) -->
        <div v-if="$slots.toolbar" class="shrink-0" :class="props.ui.toolbar">
          <slot name="toolbar" />
        </div>

        <!-- Header -->
        <div
          v-if="props.title || $slots.header || props.showClose"
          class="shrink-0 pt-3 pb-3 px-5 border-b border-white/5 flex items-center justify-between gap-4"
          :class="props.ui.header"
          data-vaul-no-drag
        >
          <div class="flex-1 min-w-0">
            <slot name="header">
              <h3
                v-if="props.title"
                class="text-base font-bold text-zinc-100 leading-tight truncate"
              >
                {{ props.title }}
              </h3>
              <p v-if="props.description" class="mt-0.5 text-xs text-zinc-400 line-clamp-2">
                {{ props.description }}
              </p>
            </slot>
          </div>

          <button
            v-if="props.showClose"
            class="shrink-0 p-2 -mr-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
            :class="props.ui.close"
            @click="onClose"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>

        <!-- Main Body -->
        <div ref="bodyRef" data-vaul-no-drag :class="bodyClasses">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="shrink-0 px-5 py-4 border-t border-zinc-800/60"
          :class="props.ui.footer"
          data-vaul-no-drag
        >
          <slot name="footer" />
        </div>
      </div>
    </template>
  </UDrawer>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 16px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
</style>
