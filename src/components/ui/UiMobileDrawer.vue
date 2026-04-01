<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';

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
  /** Custom UI classes for the container */
  ui?: {
    container?: string;
    body?: string;
    header?: string;
    footer?: string;
    toolbar?: string;
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
  ui: () => ({}),
});

const isOpen = defineModel<boolean>('open', { default: false });
const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

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
    'flex flex-col relative overflow-hidden shadow-2xl transition-all duration-300 pointer-events-auto z-50';
  const bgColor = 'bg-slate-900/95 backdrop-blur-2xl ring-1 ring-white/5';

  if (effectiveDirection.value === 'right' || effectiveDirection.value === 'left') {
    const sideBorder = effectiveDirection.value === 'right' ? 'border-l' : 'border-r';
    return `${base} max-h-dvh h-screen w-[50vw] sm:w-[40vw] ml-auto ${sideBorder} border-slate-800/80 ${bgColor} ${props.ui.container || ''}`;
  }

  const heightClass = props.isFullHeight ? 'h-[95dvh]' : 'max-h-[85dvh]';
  return `${base} ${heightClass} w-full border-t border-slate-800/80 ${bgColor} rounded-t-2xl ${props.ui.container || ''}`;
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

  // Simple tap
  if (Math.abs(dy) < 10 && adx < 10) {
    isOpen.value = false;
    return;
  }

  // Swipe down to close
  if (dy > 50 && dy > adx * 1.5) {
    e.preventDefault();
    isOpen.value = false;
    return;
  }
}

function onBackdropClick() {
  if (!props.modal) isOpen.value = false;
}

function onHandleTap() {
  if (isExpanded.value) {
    isOpen.value = false;
  } else if (props.snapPoints && props.snapPoints.length > 0) {
    activeSnapPoint.value = props.snapPoints[props.snapPoints.length - 1] as string | number;
  }
}

// --- Handle & Header Swipe Logic ---

const dragStartY = ref(0);
const dragDy = ref(0);
const bodyRef = ref<HTMLElement | null>(null);

function onDragStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragStartY.value = t.clientY;
  dragDy.value = 0;
}

function onDragMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragDy.value = t.clientY - dragStartY.value;
}

function onBodyDragStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragStartY.value = t.clientY;
  dragDy.value = 0;
}

function onBodyDragMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragDy.value = t.clientY - dragStartY.value;
}

function onBodyDragEnd() {
  if (bodyRef.value && bodyRef.value.scrollTop > 0) return;
  if (dragDy.value > 50) {
    isOpen.value = false;
    activeSnapPoint.value = null;
  }
  dragDy.value = 0;
}

function onDragEnd() {
  if (dragDy.value > 50) {
    isOpen.value = false;
    activeSnapPoint.value = null;
  }
  dragDy.value = 0;
}

function onSnapPointChange(val: string | number) {
  activeSnapPoint.value = val;
}

watch(isOpen, (val) => {
  if (!val) activeSnapPoint.value = null;
});
</script>

<template>
  <Teleport v-if="!props.modal" to="body">
    <div
      class="fixed inset-0 bg-black/55 transition-opacity duration-200 z-[30]"
      :class="[
        isOpen && isExpanded ? 'opacity-100' : 'opacity-0',
        isBackdropInteractive ? 'pointer-events-auto' : 'pointer-events-none',
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
    :ui="{ content: 'z-50' }"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <div :class="containerClasses">
        <!-- Vertical mode: drag handle -->
        <div
          v-if="
            (effectiveDirection === 'bottom' || effectiveDirection === 'top') && props.withHandle
          "
          class="shrink-0 flex justify-center py-2 relative z-10 cursor-pointer touch-none"
          @click.stop="onHandleTap"
          @touchstart.passive="onDragStart"
          @touchmove.passive="onDragMove"
          @touchend="onDragEnd"
        >
          <div class="w-10 h-1 rounded-full bg-slate-700/60"></div>
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
            class="w-1 h-12 rounded-full bg-slate-700/60 cursor-pointer pointer-events-auto"
            @click.stop="onHandleTap"
          />
        </div>

        <!-- Optional Toolbar (stays visible at first snap point) -->
        <div
          v-if="$slots.toolbar"
          class="shrink-0"
          :class="props.ui.toolbar"
          @touchstart.passive="onDragStart"
          @touchmove.passive="onDragMove"
          @touchend="onDragEnd"
        >
          <slot name="toolbar" />
        </div>

        <!-- Header -->
        <div
          v-if="props.title || $slots.header"
          class="shrink-0 pt-4 pb-3 px-5 border-t border-slate-800/60"
          :class="props.ui.header"
          @touchstart.passive="onDragStart"
          @touchmove.passive="onDragMove"
          @touchend="onDragEnd"
        >
          <slot name="header">
            <h3
              v-if="props.title"
              class="text-base font-bold text-slate-100 leading-tight truncate"
            >
              {{ props.title }}
            </h3>
            <p v-if="props.description" class="mt-1 text-xs text-slate-400 line-clamp-2">
              {{ props.description }}
            </p>
          </slot>
        </div>

        <!-- Main Body -->
        <div
          ref="bodyRef"
          class="flex-1 overflow-y-auto pb-safe custom-scrollbar"
          :class="props.ui.body"
          @touchstart.passive="onBodyDragStart"
          @touchmove.passive="onBodyDragMove"
          @touchend="onBodyDragEnd"
        >
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="shrink-0 px-5 py-4 border-t border-slate-800/60"
          :class="props.ui.footer"
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
