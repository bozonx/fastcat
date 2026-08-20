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
  /** Width classes for side drawers without snap points */
  sideWidthClass?: string;
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
  sideWidthClass: 'w-[55vw] sm:w-[45vw]',
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
  if (activeSnapPoint.value === null) return false;

  const lastPoint = props.snapPoints[props.snapPoints.length - 1];
  return activeSnapPoint.value === lastPoint;
});

const isVerticalDrawer = computed(
  () => effectiveDirection.value === 'bottom' || effectiveDirection.value === 'top',
);

const isSideDrawer = computed(
  () => effectiveDirection.value === 'right' || effectiveDirection.value === 'left',
);

/**
 * Side drawer that carries snap points behaves like the portrait toolbar sheet, but
 * along the horizontal axis: a narrow vertical toolbar rail at the first snap that
 * expands sideways to the full panel.
 */
const isSideToolbar = computed(() => isSideDrawer.value && !!props.snapPoints?.length);

/**
 * Sign of the "close" direction along the drag axis: a positive displacement always
 * moves the sheet toward dismissal (down for bottom, up for top, right for right,
 * left for left). The handle gesture logic is written in this close-positive space
 * so a single code path drives both portrait (vertical) and landscape (horizontal).
 */
const closeSign = computed(() =>
  effectiveDirection.value === 'top' || effectiveDirection.value === 'left' ? -1 : 1,
);

function toRenderedSnapPoint(point: number | string) {
  if (typeof point === 'string') return point;
  // Numeric fractions are resolved to integer pixels (sharp text, no sub-pixel
  // blur): of the viewport height for vertical drawers, of the width for side ones.
  return isVerticalDrawer.value
    ? `${Math.floor(height.value * point)}px`
    : `${Math.floor(width.value * point)}px`;
}

const renderedSnapPoints = computed(() => props.snapPoints?.map(toRenderedSnapPoint));

/**
 * Snap geometry is layout-driven instead of delegated to vaul. Vaul keeps drawers
 * with snap points on a permanent translate3d layer, which makes Chromium rasterize
 * descendant text and visibly softens it at fractional display scales. The inner
 * container changes height/width instead, leaving the resting drawer untransformed.
 */
const lastActiveSnapPoint = ref<string | number | null>(activeSnapPoint.value);

watch(activeSnapPoint, (point) => {
  if (point !== null) lastActiveSnapPoint.value = point;
});

/** Rail (first) and full (last) snap widths in px, for the side toolbar. */
const sideRailFullPx = computed(() => {
  const pts = renderedSnapPoints.value;
  if (!isSideToolbar.value || !pts || pts.length < 2) return null;
  const toPx = (v: string | number) => (typeof v === 'number' ? v : parseFloat(v) || 0);
  return { rail: toPx(pts[0]!), full: toPx(pts[pts.length - 1]!) };
});

/** Live width while the side rail is dragged; null = settle to the snap width. */
const sideDragWidth = ref<number | null>(null);
const sideDragging = ref(false);

const sideBaseWidth = computed(() => {
  const rf = sideRailFullPx.value;
  if (!rf) return null;
  return isExpanded.value ? rf.full : rf.rail;
});

const activeVerticalSnapHeight = computed(() => {
  if (!props.snapPoints?.length) return undefined;
  if (!isVerticalDrawer.value) return undefined;

  const activeIndex = props.snapPoints.findIndex((point) => point === activeSnapPoint.value);
  const previousIndex = props.snapPoints.findIndex((point) => point === lastActiveSnapPoint.value);
  const index =
    activeIndex >= 0
      ? activeIndex
      : !isOpen.value && previousIndex >= 0
        ? previousIndex
        : props.snapPoints.length - 1;
  return renderedSnapPoints.value?.[index];
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

/**
 * This sheet owns its own dismissal entirely (custom backdrop tap/swipe + drag
 * handle), so we neutralize Reka's built-in "interact outside" auto-dismiss.
 *
 * Without this, opening one sheet directly from another flashes the new sheet open
 * and then instantly closes it: when the first sheet finishes its close animation,
 * Reka's non-modal `closeAutoFocus` restores focus to the button that opened it —
 * a `focusin` OUTSIDE the new sheet. The new sheet's DismissableLayer treats that as
 * an outside interaction and dismisses itself. Preventing `interactOutside` (the
 * single chokepoint for both the focus- and pointer-driven dismiss paths) stops it.
 */
const drawerContentProps = {
  onInteractOutside: (e: Event) => e.preventDefault(),
  onFocusOutside: (e: Event) => e.preventDefault(),
};

/** Responsive container logic */
const containerClasses = computed(() => {
  const base = `relative shadow-2xl transition-all duration-300 pointer-events-auto ${props.zIndex}`;
  const bgColor = 'bg-ui-bg-elevated ring-1 ring-white/10';

  if (isSideDrawer.value) {
    const sideBorder = effectiveDirection.value === 'right' ? 'border-l' : 'border-r';
    // Toolbar mode lays the rail and panel out side-by-side; the width comes from
    // the snap (containerStyle), so no fixed width class. A plain side drawer keeps
    // its responsive width.
    const flow = isSideToolbar.value ? 'flex flex-row' : 'flex flex-col';
    const widthClass = props.snapPoints?.length ? '' : props.sideWidthClass;
    return `${base} ${flow} max-h-dvh h-screen ${widthClass} ml-auto ${sideBorder} border-ui-border/80 ${bgColor} ${props.ui.container || ''}`.replace(
      /  +/g,
      ' ',
    );
  }

  const heightClass = props.snapPoints?.length
    ? ''
    : props.isFullHeight
      ? 'h-[95dvh]'
      : 'max-h-[85dvh]';
  return `${base} flex flex-col ${heightClass} w-full border-t border-ui-border/80 ${bgColor} rounded-t-2xl ${props.ui.container || ''}`.replace(
    /  +/g,
    ' ',
  );
});

const toolbarWrapperClass = computed(() => {
  if (isSideToolbar.value) {
    return `shrink-0 w-[54px] h-full overflow-hidden ${props.ui.toolbar || ''}`;
  }
  const snapClass = !isExpanded.value ? 'toolbar-snap-pb' : '';
  return `shrink-0 ${snapClass} ${props.ui.toolbar || ''}`;
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

const containerStyle = computed(() => {
  if (activeVerticalSnapHeight.value) {
    return {
      height: activeVerticalSnapHeight.value,
      transition: handleDragging.value ? 'none' : `height ${ANIMATION_EXPAND_MS}ms ${SETTLE_EASE}`,
    };
  }
  if (isSideToolbar.value && sideBaseWidth.value !== null) {
    const w = sideDragWidth.value ?? sideBaseWidth.value;
    // No transition while the finger drives the width, so the rail tracks the
    // drag; the standing `transition-all duration-300` animates the settle.
    return { width: `${w}px`, transition: sideDragging.value ? 'none' : undefined };
  }
  return undefined;
});

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
 * On release the container animates its layout height/width to the selected snap
 * and settles the temporary drag transform to 0 in sync. Close is a single
 * slide-out we drive here.
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

/** Start coordinate of the active handle drag, along the drawer's drag axis. */
const handleStart = ref(0);
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

/**
 * Visual transform for a close-positive displacement `d`. `d` measures movement
 * toward dismissal; the raw on-axis offset is `d * closeSign`, so the sheet always
 * follows the finger regardless of which edge it is docked to.
 */
function transformForDisplacement(d: number) {
  const offset = d * closeSign.value;
  return isVerticalDrawer.value
    ? `translate3d(0, ${offset}px, 0)`
    : `translate3d(${offset}px, 0, 0)`;
}

/** Instant transform while the finger drives the sheet (no transition lag). */
function setHandleTransform(d: number) {
  const el = containerRef.value;
  if (!el) return;
  if (handleAnim) {
    handleAnim.cancel();
    handleAnim = null;
  }
  el.style.transition = 'none';
  el.style.transform = d === 0 ? '' : transformForDisplacement(d);
}

/**
 * Animate the container from the release position to a target offset.
 * Uses the Web Animations API: a plain CSS transition started in the same tick as
 * the preceding instant drag transform does not fire reliably, which made the
 * sheet jump (disappear) instead of sliding. WAA is deterministic about the start.
 */
function animateHandle(fromD: number, toD: number, ms: number, done?: () => void) {
  const el = containerRef.value;
  const from = transformForDisplacement(fromD);
  const to = transformForDisplacement(toD);

  if (!el || typeof el.animate !== 'function') {
    if (el) el.style.transform = toD === 0 ? '' : to;
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
    el.style.transform = toD === 0 ? '' : to;
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

/** Touch coordinate along the active drag axis. */
function axisCoord(t: Touch) {
  return isVerticalDrawer.value ? t.clientY : t.clientX;
}

/** Close-positive displacement of a touch from the drag start. */
function displacementFrom(t: Touch) {
  return (axisCoord(t) - handleStart.value) * closeSign.value;
}

/** Clamp a close-positive displacement to the legal travel for the current mode. */
function clampDisplacement(d: number) {
  if (isExpanded.value) return d < 0 ? 0 : d; // full: can only move toward close
  return d < -toolbarOffsetPx.value ? -toolbarOffsetPx.value : d; // rail: reveal up to full
}

function onHandleTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  handleStart.value = axisCoord(t);
  handleDragging.value = true;
  handleDragged.value = false;
  if (isSideToolbar.value) {
    sideDragging.value = true;
    sideDragWidth.value = sideBaseWidth.value;
  }
}

function onHandleTouchMove(e: TouchEvent) {
  if (!handleDragging.value) return;
  const t = e.touches[0];
  if (!t) return;
  const d = clampDisplacement(displacementFrom(t));
  if (Math.abs(d) > 6) handleDragged.value = true;

  // Side toolbar: translate the drag into a live container width (grows leftward as
  // it expands). A close-positive displacement shrinks the panel.
  if (isSideToolbar.value) {
    const rf = sideRailFullPx.value;
    if (rf) sideDragWidth.value = Math.max(0, Math.min(rf.full, (sideBaseWidth.value ?? 0) - d));
    return;
  }

  setHandleTransform(d);
}

function onHandleTouchEnd(e: TouchEvent) {
  if (!handleDragging.value) return;
  handleDragging.value = false;
  const t = e.changedTouches[0];
  const d = clampDisplacement(t ? displacementFrom(t) : 0);

  // Side toolbar: hand the width back to the snap (CSS-animated) and pick the
  // outcome from the same thresholds the vertical sheet uses.
  if (isSideToolbar.value) {
    sideDragging.value = false;
    sideDragWidth.value = null;
    if (Math.abs(d) < TAP_THRESHOLD_PX) return;
    if (isExpanded.value) {
      if (d > CLOSE_FULL_THRESHOLD_PX) requestClose();
      return;
    }
    if (d > CLOSE_TOOLBAR_THRESHOLD_PX) requestClose();
    else if (d < -EXPAND_THRESHOLD_PX) expandByHandle(d);
    return;
  }

  if (Math.abs(d) < TAP_THRESHOLD_PX) {
    resetHandleTransform();
    return;
  }

  if (isExpanded.value) {
    if (d > CLOSE_FULL_THRESHOLD_PX) closeByHandle(d);
    else settleHandle(d);
    return;
  }

  if (d > CLOSE_TOOLBAR_THRESHOLD_PX) closeByHandle(d);
  else if (d < -EXPAND_THRESHOLD_PX) expandByHandle(d);
  else settleHandle(d);
}

/** Ease back to the current snap position. */
function settleHandle(fromD: number) {
  animateHandle(fromD, 0, ANIMATION_SETTLE_MS, resetHandleTransform);
}

/** Expand to the full layout snap while settling the temporary drag transform. */
function expandByHandle(fromD: number) {
  if (props.snapPoints?.length) {
    activeSnapPoint.value = props.snapPoints[props.snapPoints.length - 1] as string | number;
  }
  // The side toolbar animates its width via the standing CSS transition once the
  // snap (and thus sideBaseWidth) changes — no transform to settle.
  if (isSideToolbar.value) return;
  animateHandle(fromD, 0, ANIMATION_EXPAND_MS, resetHandleTransform);
}

/** Slide the sheet out from the release position, then unmount. */
function closeByHandle(fromD: number) {
  handleClosing.value = true;
  const el = containerRef.value;
  const rect = el?.getBoundingClientRect();

  // Animate only as far as it takes the sheet's leading edge to clear the viewport.
  // In toolbar mode the sheet already sits near the screen edge, so a fixed
  // viewport-sized target would push the visible sliver off-screen in the first few
  // ms (with the fast-start easing) and the slide-out would be invisible. Deriving
  // the target from the current rect keeps the on-screen travel — and thus the
  // perceived speed — consistent across toolbar and full modes. The rect already
  // reflects the in-flight drag transform (fromD).
  let toD: number;
  if (isVerticalDrawer.value) {
    const viewportH = window.innerHeight || 900;
    toD = rect ? fromD + (viewportH - rect.top) : viewportH;
  } else {
    // Push the sheet out by its own width past the current position; this clears
    // the screen edge regardless of which side it is docked to.
    toD = fromD + (rect ? rect.width : window.innerWidth || 1200);
  }

  animateHandle(fromD, toD, ANIMATION_CLOSE_MS, () => requestClose());
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
    :key="effectiveDirection"
    v-model:open="isOpen"
    :direction="effectiveDirection"
    :title="drawerTitleForA11y"
    :description="drawerDescriptionForA11y"
    :dismissible="props.dismissible"
    :should-scale-background="props.shouldScaleBackground"
    :modal="false"
    :overlay="false"
    :handle="false"
    :content="drawerContentProps"
    :ui="drawerUi"
  >
    <template #content>
      <div ref="containerRef" data-mobile-drawer :class="containerClasses" :style="containerStyle">
        <!-- Vertical mode: drag handle (revealed edge = top) -->
        <div
          v-if="isVerticalDrawer && props.withHandle"
          class="shrink-0 relative z-10 cursor-pointer group"
          data-vaul-no-drag
          @click.stop="onHandleTap"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
        >
          <div class="flex justify-center py-2">
            <div
              class="w-12 h-1.5 rounded-full bg-ui-border/40 group-hover:bg-ui-text-muted/60 transition-colors"
            ></div>
          </div>
        </div>

        <!-- Side toolbar mode: inline drag handle on the inner edge (in flex flow,
             so it sits beside the rail rather than overlapping it). -->
        <div
          v-if="isSideToolbar && props.withHandle"
          class="shrink-0 self-stretch w-5 flex items-center justify-center cursor-pointer touch-none"
          :class="effectiveDirection === 'right' ? 'order-first' : 'order-last'"
          data-vaul-no-drag
          @click.stop="onHandleTap"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
        >
          <div
            class="w-1 h-12 rounded-full bg-ui-border/60 transition-colors hover:bg-ui-text-muted/60"
          />
        </div>

        <!-- Plain side mode (no snap): lateral overlay handle -->
        <div
          v-if="isSideDrawer && !isSideToolbar && props.withHandle"
          class="absolute top-0 bottom-0 flex flex-col items-center justify-center cursor-pointer pointer-events-auto touch-none"
          :class="effectiveDirection === 'right' ? 'left-0 w-6' : 'right-0 w-6'"
          data-vaul-no-drag
          @click.stop="onHandleTap"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
        >
          <div
            class="w-1 h-12 rounded-full bg-ui-border/60 transition-colors hover:bg-ui-text-muted/60"
          />
        </div>

        <!-- Optional Toolbar (stays visible at first snap point). In side mode it is
             the vertical rail revealed at the inner edge; in portrait, the top row. -->
        <div v-if="$slots.toolbar" :class="toolbarWrapperClass">
          <slot name="toolbar" />
        </div>

        <!-- Header + body + footer. In side toolbar mode they form the panel column
             beside the rail; otherwise `contents` keeps them as direct flex items of
             the sheet so the existing vertical layout is unchanged. -->
        <div :class="isSideToolbar ? 'flex-1 min-w-0 overflow-hidden flex flex-col' : 'contents'">
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

.toolbar-snap-pb {
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
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
