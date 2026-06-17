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
  /** Custom z-index class override, defaults to 'z-[var(--z-fixed)]' */
  zIndex?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  snapPoints: undefined,
  shouldScaleBackground: false,
  dismissible: true,
  direction: undefined,
  isFullHeight: false,
  overlay: true,
  withHandle: true,
  showClose: true,
  ui: () => ({}),
  zIndex: 'z-[var(--z-fixed)]',
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

const backdropZIndexClass = computed(() => {
  if (props.zIndex === 'z-[var(--z-fixed)]') {
    return 'z-[calc(var(--z-fixed)-1)]';
  }
  if (props.zIndex === 'z-[var(--z-modal)]') {
    return 'z-[var(--z-modal-backdrop)]';
  }
  const match = props.zIndex.match(/^z-\[(\d+)\]$/);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    return `z-[${val - 1}]`;
  }
  return `z-[calc(${props.zIndex.replace(/^z-\[?/, '').replace(/\]?$/, '')}-1)]`;
});

const drawerUi = computed(() => ({
  content: `mobile-drawer-vaul-content ${props.zIndex} shadow-none ring-0 bg-transparent mt-0`,
  overlay: backdropZIndexClass.value,
}));

/** Responsive container logic */
const containerClasses = computed(() => {
  const base = `flex flex-col relative shadow-2xl transition-all duration-300 pointer-events-auto ${props.zIndex}`;
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
const footerRef = ref<HTMLElement | null>(null);

const isBackdropInteractive = computed(
  () =>
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
  const el = containerRef.value;
  if (!el) return;
  if (dx !== 0 || dy !== 0) {
    // Kill the container's standing `transition-all duration-300` while the finger
    // drives the sheet, otherwise every transform update is interpolated over 300ms
    // and the sheet visibly lags behind the finger (unlike the handle drag, which
    // already disables the transition in setHandleTransform).
    el.style.transition = 'none';
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  } else {
    // Restore the CSS transition so the release settles back to 0 smoothly.
    el.style.removeProperty('transition');
    el.style.removeProperty('transform');
  }
}

const bodyRef = ref<HTMLElement | null>(null);

/**
 * Handle gesture (vertical drawers).
 *
 * We fully own the handle drag — the handle is marked `data-vaul-no-drag`, so vaul
 * does not also drive it — and translate the container to follow the finger. This
 * lets the sheet close on a SMALL downward movement (the toolbar sheet is short, so
 * the long drag vaul needs to dismiss is awkward) WITHOUT the "snap back, then
 * close" double animation that happens when our action races vaul's own release.
 *
 * On release we hand the toolbar<->full transition back to vaul (it animates the
 * snap change) and settle our own offset to 0 in sync, so the motion is continuous
 * from the finger's release position. Close is a single slide-out we drive here.
 */
const SETTLE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// Gesture thresholds (px)
const TAP_THRESHOLD_PX = 10;
const CLOSE_TOOLBAR_THRESHOLD_PX = 28;
const CLOSE_FULL_THRESHOLD_PX = 64;
const EXPAND_THRESHOLD_PX = 40;
const BACKDROP_SWIPE_THRESHOLD_PX = 50;

// Animation durations (ms)
const ANIMATION_SETTLE_MS = 320;
const ANIMATION_EXPAND_MS = 460;
const ANIMATION_CLOSE_MS = 280;
const BACKDROP_SHOW_DELAY_MS = 80;
const FOCUS_DELAY_MS = 400;

const handleStartY = ref(0);
const handleDragging = ref(false);
const handleDragged = ref(false);
/** True while we slide the sheet out ourselves, so the close watcher leaves our
 *  off-screen transform in place (removing it would flash the sheet back in). */
const handleClosing = ref(false);

/** Pixel gap between the full and the toolbar snap — how far "expand" travels up. */
const toolbarOffsetPx = computed(() => {
  const pts = renderedSnapPoints.value;
  if (!pts || pts.length < 2) return 0;
  const toPx = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v) || 0);
  return Math.max(0, toPx(pts[pts.length - 1]!) - toPx(pts[0]!));
});

let handleAnim: Animation | null = null;

/** Instant transform while the finger drives the sheet (no transition lag). */
function setHandleTransform(dy: number) {
  const el = containerRef.value;
  if (!el) return;
  if (handleAnim) {
    handleAnim.cancel();
    handleAnim = null;
  }
  el.style.transition = 'none';
  el.style.transform = dy === 0 ? '' : `translate3d(0, ${dy}px, 0)`;
}

/**
 * Animate the container from the release position to a target offset.
 * Uses the Web Animations API: a plain CSS transition started in the same tick as
 * the preceding instant drag transform does not fire reliably, which made the
 * sheet jump (disappear) instead of sliding. WAA is deterministic about the start.
 */
function animateHandle(fromDy: number, toDy: number, ms: number, done?: () => void) {
  const el = containerRef.value;
  const from = `translate3d(0, ${fromDy}px, 0)`;
  const to = toDy === 0 ? 'translate3d(0, 0, 0)' : `translate3d(0, ${toDy}px, 0)`;

  if (!el || typeof el.animate !== 'function') {
    if (el) el.style.transform = toDy === 0 ? '' : to;
    done?.();
    return;
  }

  if (handleAnim) handleAnim.cancel();
  el.style.transform = from;
  handleAnim = el.animate([{ transform: from }, { transform: to }], {
    duration: ms,
    easing: SETTLE_EASE,
    fill: 'forwards',
  });
  handleAnim.onfinish = () => {
    el.style.transform = toDy === 0 ? '' : to;
    handleAnim?.cancel();
    handleAnim = null;
    done?.();
  };
}

function resetHandleTransform() {
  const el = containerRef.value;
  if (!el || handleDragging.value) return;
  if (handleAnim) {
    handleAnim.cancel();
    handleAnim = null;
  }
  el.style.removeProperty('transition');
  el.style.removeProperty('transform');
}

function onHandleTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  handleStartY.value = t.clientY;
  handleDragging.value = true;
  handleDragged.value = false;
}

function onHandleTouchMove(e: TouchEvent) {
  if (!handleDragging.value) return;
  const t = e.touches[0];
  if (!t) return;
  let dy = t.clientY - handleStartY.value;
  if (Math.abs(dy) > 6) handleDragged.value = true;

  if (isExpanded.value) {
    // Full mode: follow downward only; an upward swipe does nothing.
    if (dy < 0) dy = 0;
  } else {
    // Toolbar mode: can't reveal more than the full height.
    const maxUp = -toolbarOffsetPx.value;
    if (dy < maxUp) dy = maxUp;
  }
  setHandleTransform(dy);
}

function onHandleTouchEnd(e: TouchEvent) {
  if (!handleDragging.value) return;
  handleDragging.value = false;
  const t = e.changedTouches[0];
  let dy = t ? t.clientY - handleStartY.value : 0;
  if (isExpanded.value && dy < 0) dy = 0;
  else if (!isExpanded.value && dy < -toolbarOffsetPx.value) dy = -toolbarOffsetPx.value;

  if (Math.abs(dy) < TAP_THRESHOLD_PX) {
    resetHandleTransform();
    return;
  }

  if (isExpanded.value) {
    if (dy > CLOSE_FULL_THRESHOLD_PX) closeByHandle(dy);
    else settleHandle(dy);
    return;
  }

  if (dy > CLOSE_TOOLBAR_THRESHOLD_PX) closeByHandle(dy);
  else if (dy < -EXPAND_THRESHOLD_PX) expandByHandle(dy);
  else settleHandle(dy);
}

/** Ease back to the current snap position. */
function settleHandle(fromDy: number) {
  animateHandle(fromDy, 0, ANIMATION_SETTLE_MS, resetHandleTransform);
}

/** Hand off to the full snap, syncing our offset with vaul's snap transition. */
function expandByHandle(fromDy: number) {
  if (props.snapPoints?.length) {
    activeSnapPoint.value = props.snapPoints[props.snapPoints.length - 1] as string | number;
  }
  animateHandle(fromDy, 0, ANIMATION_EXPAND_MS, resetHandleTransform);
}

/** Slide the sheet out from the release position, then unmount. */
function closeByHandle(fromDy: number) {
  handleClosing.value = true;
  const viewportH = window.innerHeight || 900;

  // Animate only as far as it takes the sheet's TOP edge to reach the bottom of
  // the viewport. In toolbar mode the sheet already sits near the bottom, so a
  // fixed `viewportH` target would push the visible part off-screen in the first
  // few ms (with the fast-start easing) and the slide-down would be invisible.
  // Deriving the target from the current rect keeps the on-screen travel — and
  // thus the perceived speed — consistent across toolbar and full modes.
  const el = containerRef.value;
  let toDy = viewportH;
  if (el) {
    // rect.top already reflects the in-flight drag transform (fromDy).
    const rect = el.getBoundingClientRect();
    toDy = fromDy + (viewportH - rect.top);
  }

  animateHandle(fromDy, toDy, ANIMATION_CLOSE_MS, () => requestClose());
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
  if (Math.abs(dy) < TAP_THRESHOLD_PX && Math.abs(dx) < TAP_THRESHOLD_PX) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    requestClose();
    return;
  }

  if (dir === 'bottom' || dir === 'top') {
    if (dy > BACKDROP_SWIPE_THRESHOLD_PX && dy > Math.abs(dx) * 1.5) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  } else if (dir === 'right') {
    if (dx > BACKDROP_SWIPE_THRESHOLD_PX) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  } else if (dir === 'left') {
    if (dx < -BACKDROP_SWIPE_THRESHOLD_PX) {
      if (e.cancelable) e.preventDefault();
      requestClose();
    }
  }
}

function onBackdropClick(e: MouseEvent) {
  // Mouse path (touch is handled in onBackdropTouchEnd). Swallow the event so it
  // never reaches content below the backdrop.
  e.stopPropagation();
  requestClose();
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
    }, BACKDROP_SHOW_DELAY_MS);
  } else {
    isBackdropVisible.value = false;
  }
});

watch(isOpen, (val) => {
  if (!val) {
    activeSnapPoint.value = null;
    handleDragging.value = false;
    // When we drive the close ourselves the container is already animating
    // off-screen — keep that transform so the sheet doesn't flash back in.
    if (!handleClosing.value) applyDragTransform(0, 0);
  } else {
    handleDragging.value = false;
    handleClosing.value = false;
    resetHandleTransform();
    // Focus management
    nextTick(() => {
      setTimeout(() => {
        let target: HTMLElement | null = null;

        if (bodyRef.value) {
          target = bodyRef.value.querySelector<HTMLElement>(
            '[data-primary-focus="true"], [autofocus]',
          );
        }

        if (!target && footerRef.value) {
          target = footerRef.value.querySelector<HTMLElement>(
            '[data-primary-focus="true"], [autofocus]',
          );
        }

        if (target) {
          target.focus();
        }
      }, FOCUS_DELAY_MS); // Wait for transition completion
    });
  }
});
</script>

<template>
  <Teleport :to="effectiveTeleportTarget">
    <div
      class="fixed inset-0 bg-ui-bg/40 backdrop-blur-[2px] transition-all duration-300"
      :class="[
        isBackdropVisible
          ? ['pointer-events-auto', props.overlay ? 'opacity-100' : 'opacity-0']
          : 'opacity-0 pointer-events-none',
        backdropZIndexClass,
      ]"
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
    :modal="false"
    :overlay="false"
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
          data-vaul-no-drag
          @click.stop="onHandleTap"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
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
          ref="footerRef"
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
