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
const emit = defineEmits<{
  (e: 'close'): void;
}>();

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

const isVerticalDrawer = computed(
  () => effectiveDirection.value === 'bottom' || effectiveDirection.value === 'top',
);

function toRenderedSnapPoint(point: number | string) {
  if (typeof point === 'string' || !isVerticalDrawer.value) return point;
  return `${Math.floor(height.value * point)}px`;
}

const renderedSnapPoints = computed(() => props.snapPoints?.map(toRenderedSnapPoint));

const renderedActiveSnapPoint = computed(() => {
  if (activeSnapPoint.value === null) return undefined;
  return toRenderedSnapPoint(activeSnapPoint.value);
});

/**
 * Compute max-height from the largest snap point.
 * vaul-vue renders the DrawerContent at full viewport height and translates it,
 * so without this constraint the container overflows behind the screen edge.
 */
const snapContentHeight = computed(() => {
  if (!props.snapPoints?.length) return undefined;
  if (effectiveDirection.value !== 'bottom' && effectiveDirection.value !== 'top') return undefined;
  const lastPoint = props.snapPoints[props.snapPoints.length - 1];
  if (typeof lastPoint === 'number') return `${Math.floor(height.value * lastPoint)}px`;
  return undefined;
});

const drawerUi = computed(() => ({
  content: 'mobile-drawer-vaul-content z-[var(--z-fixed)] shadow-none ring-0 bg-transparent mt-0',
}));

/** Responsive container logic */
const containerClasses = computed(() => {
  const base =
    'flex flex-col relative overflow-hidden shadow-2xl transition-all duration-300 pointer-events-auto z-[var(--z-fixed)]';
  const bgColor = 'bg-ui-bg-elevated ring-1 ring-white/10';

  if (effectiveDirection.value === 'right' || effectiveDirection.value === 'left') {
    const sideBorder = effectiveDirection.value === 'right' ? 'border-l' : 'border-r';
    return `${base} max-h-dvh h-screen w-[55vw] sm:w-[45vw] ml-auto ${sideBorder} border-ui-border/80 ${bgColor} ${props.ui.container || ''}`;
  }

  const heightClass = props.snapPoints?.length
    ? ''
    : props.isFullHeight
      ? 'h-[95dvh]'
      : 'max-h-[85dvh]';
  return `${base} ${heightClass} w-full border-t border-ui-border/80 ${bgColor} rounded-t-2xl ${props.ui.container || ''}`.replace(
    /  +/g,
    ' ',
  );
});

const bodyClasses = computed(() => {
  return `flex-1 min-h-0 overflow-y-auto pb-safe custom-scrollbar ${props.ui.body || ''}`;
});

// --- Non-modal Backdrop Logic (for interactive drawers like timeline) ---

const bdStartY = ref(0);
const bdStartX = ref(0);
const bdDy = ref(0);
const bdDx = ref(0);

const containerRef = ref<HTMLElement | null>(null);

const isBackdropInteractive = computed(
  () =>
    !props.modal &&
    isOpen.value &&
    isExpanded.value &&
    (effectiveDirection.value === 'bottom' ||
      effectiveDirection.value === 'top' ||
      effectiveDirection.value === 'right' ||
      effectiveDirection.value === 'left'),
);

const containerStyle = computed(() =>
  snapContentHeight.value ? { height: snapContentHeight.value } : undefined,
);

function applyDragTransform(dx: number, dy: number) {
  if (!containerRef.value) return;
  if (dx !== 0 || dy !== 0) {
    containerRef.value.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  } else {
    containerRef.value.style.removeProperty('transform');
  }
}

const bodyRef = ref<HTMLElement | null>(null);

/**
 * Handle gesture: vaul-vue owns the actual drag — the sheet follows the finger
 * and vaul decides the release outcome (drag up snaps to the next point / full,
 * drag down from the lowest snap dismisses because the drawer is dismissible).
 *
 * We deliberately do NOT close/expand ourselves on release: doing so races vaul's
 * own release animation, so the sheet first snaps back and then re-animates — the
 * "animation starts again" glitch. Here we only record whether the touch became a
 * drag, so the trailing synthetic click doesn't also fire the tap handler.
 */
const handleStartY = ref(0);
const handleDragged = ref(false);

function onHandleTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  handleStartY.value = t.clientY;
  handleDragged.value = false;
}

function onHandleTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  if (Math.abs(t.clientY - handleStartY.value) > 8) handleDragged.value = true;
}

function onBackdropTouchStart(e: TouchEvent) {
  if (!isBackdropInteractive.value) return;
  const t = e.touches[0];
  if (!t) return;
  bdStartY.value = t.clientY;
  bdStartX.value = t.clientX;
  bdDy.value = 0;
  bdDx.value = 0;
}

function onBackdropTouchMove(e: TouchEvent) {
  if (!isBackdropInteractive.value) return;
  const t = e.touches[0];
  if (!t) return;
  bdDy.value = t.clientY - bdStartY.value;
  bdDx.value = t.clientX - bdStartX.value;

  const dir = effectiveDirection.value;
  if (dir === 'bottom') {
    applyDragTransform(0, Math.max(0, bdDy.value));
  } else if (dir === 'right') {
    applyDragTransform(Math.max(0, bdDx.value), 0);
  } else if (dir === 'left') {
    applyDragTransform(Math.min(0, bdDx.value), 0);
  }
}

function onBackdropTouchEnd(e: TouchEvent) {
  if (!isBackdropInteractive.value) return;
  applyDragTransform(0, 0);

  const dy = bdDy.value;
  const dx = bdDx.value;
  const dir = effectiveDirection.value;

  // A tap on the backdrop closes the sheet and must NOT pass through to whatever
  // is underneath. preventDefault on touchend suppresses the trailing synthetic
  // mouse/click events, which would otherwise hit the element below once the
  // backdrop turns non-interactive on close.
  if (Math.abs(dy) < 10 && Math.abs(dx) < 10) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    requestClose();
    return;
  }

  if (dir === 'bottom' || dir === 'top') {
    if (dy > 50 && dy > Math.abs(dx) * 1.5) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  } else if (dir === 'right') {
    if (dx > 50) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  } else if (dir === 'left') {
    if (dx < -50) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  }
}

function onBackdropClick(e: MouseEvent) {
  // Mouse path (touch is handled in onBackdropTouchEnd). Swallow the event so it
  // never reaches content below the backdrop.
  e.stopPropagation();
  if (!props.modal) requestClose();
}

function onClose() {
  requestClose();
}

function requestClose() {
  isOpen.value = false;
  emit('close');
}

function onHandleTap() {
  // A drag was already handled by vaul; ignore the trailing synthetic click.
  if (handleDragged.value) {
    handleDragged.value = false;
    return;
  }

  if (isExpanded.value) {
    requestClose();
    return;
  }

  if (props.snapPoints && props.snapPoints.length > 0) {
    activeSnapPoint.value = props.snapPoints[props.snapPoints.length - 1] as string | number;
    return;
  }

  isOpen.value = true;
}

function onSnapPointChange(val: string | number) {
  const renderedIndex = renderedSnapPoints.value?.findIndex((point) => point === val) ?? -1;
  activeSnapPoint.value =
    renderedIndex >= 0 && props.snapPoints ? (props.snapPoints[renderedIndex] ?? val) : val;
}

// --- Backdrop visibility (debounced to avoid flash on re-open) ---
const isBackdropVisible = ref(false);
let backdropShowTimer: ReturnType<typeof setTimeout> | null = null;

watch([isOpen, isExpanded], ([open, expanded]) => {
  if (backdropShowTimer) {
    clearTimeout(backdropShowTimer);
    backdropShowTimer = null;
  }
  if (open && expanded) {
    backdropShowTimer = setTimeout(() => {
      isBackdropVisible.value = true;
    }, 80);
  } else {
    isBackdropVisible.value = false;
  }
});

watch(isOpen, (val) => {
  if (!val) {
    activeSnapPoint.value = null;
    applyDragTransform(0, 0);
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
      class="fixed inset-0 bg-ui-bg/40 backdrop-blur-[2px] transition-all duration-300 z-[calc(var(--z-fixed)-1)]"
      :class="
        isBackdropVisible
          ? ['pointer-events-auto', props.overlay ? 'opacity-100' : 'opacity-0']
          : 'opacity-0 pointer-events-none'
      "
      :style="{ touchAction: isBackdropInteractive ? 'none' : 'auto' }"
      @touchstart.passive="onBackdropTouchStart"
      @touchmove.passive="onBackdropTouchMove"
      @touchend="onBackdropTouchEnd"
      @click.stop="onBackdropClick"
    />
  </Teleport>

  <UDrawer
    v-model:open="isOpen"
    :direction="effectiveDirection"
    :title="drawerTitleForA11y"
    :description="drawerDescriptionForA11y"
    :snap-points="renderedSnapPoints"
    :active-snap-point="renderedActiveSnapPoint"
    :dismissible="props.dismissible"
    :should-scale-background="props.shouldScaleBackground"
    :modal="props.modal"
    :overlay="props.modal && props.overlay"
    :handle="false"
    :ui="drawerUi"
    @update:active-snap-point="onSnapPointChange"
  >
    <template #content>
      <div ref="containerRef" :class="containerClasses" :style="containerStyle">
        <!-- Vertical mode: drag handle -->
        <div
          v-if="
            (effectiveDirection === 'bottom' || effectiveDirection === 'top') && props.withHandle
          "
          class="shrink-0 relative z-10 cursor-pointer group"
          @click.stop="onHandleTap"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
        >
          <div class="flex justify-center py-2.5">
            <div
              class="w-12 h-1.5 rounded-full bg-ui-border/40 group-hover:bg-ui-text-muted/60 transition-colors"
            ></div>
          </div>
        </div>

        <!-- Side mode: lateral handle -->
        <div
          v-if="
            (effectiveDirection === 'right' || effectiveDirection === 'left') && props.withHandle
          "
          class="absolute top-0 bottom-0 flex flex-col items-center justify-center cursor-pointer pointer-events-auto"
          :class="effectiveDirection === 'right' ? 'left-0 w-6' : 'right-0 w-6'"
          @click.stop="onHandleTap"
        >
          <div
            class="w-1 h-12 rounded-full bg-ui-border/60 transition-colors hover:bg-ui-text-muted/60"
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
                class="text-base font-bold text-ui-text leading-tight truncate"
              >
                {{ props.title }}
              </h3>
              <p v-if="props.description" class="mt-0.5 text-xs text-ui-text-muted line-clamp-2">
                {{ props.description }}
              </p>
            </slot>
          </div>

          <button
            v-if="props.showClose"
            class="shrink-0 p-2 -mr-2 rounded-full text-ui-text-muted hover:text-ui-text hover:bg-white/10 transition-colors"
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
          class="shrink-0 px-5 py-4 border-t border-ui-border/60"
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
/**
 * When expanded, the sheet bottom is anchored to the viewport edge, so the last
 * rows would otherwise sit under the home indicator / screen edge. Reserve the
 * safe-area inset plus a fixed buffer (the inset resolves to 0 in some webviews).
 */
.pb-safe {
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.5rem);
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

:global(
  .mobile-drawer-vaul-content[data-vaul-drawer][data-vaul-drawer-direction='bottom'][data-state='open'][data-vaul-snap-points='false']
),
:global(
  .mobile-drawer-vaul-content[data-vaul-drawer][data-vaul-drawer-direction='top'][data-state='open'][data-vaul-snap-points='false']
) {
  transform: none !important;
  will-change: auto;
}
</style>
