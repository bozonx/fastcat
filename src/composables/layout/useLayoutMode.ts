import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';

export type LayoutMode = 'desktop' | 'mobile';
/** `auto` resolves from the container's first measured size. */
export type LayoutModePreference = 'auto' | LayoutMode;

/**
 * A container narrower than this gets the touch-oriented shell. The threshold is
 * about the *container*, not the device: a 420px-wide panel on a desktop needs
 * the mobile layout, and a tablet in landscape does not.
 */
const MOBILE_MAX_WIDTH_PX = 768;
/** Monitor plus timeline need vertical room; a short viewport gets the drawers. */
const MOBILE_MAX_HEIGHT_PX = 480;

/**
 * Module-level override consulted by {@link useMobileLayout}. A singleton rather
 * than provide/inject because consumers include Pinia stores, which have no
 * component instance to inject from.
 *
 * `null` means "no explicit mode" and the standalone app's route-based rule
 * applies.
 */
const layoutModeOverride = ref<LayoutMode | null>(null);

export function getLayoutModeOverride(): Readonly<Ref<LayoutMode | null>> {
  return layoutModeOverride;
}

export function setLayoutModeOverride(mode: LayoutMode | null): void {
  layoutModeOverride.value = mode;
}

export function resolveLayoutModeForSize(width: number, height: number): LayoutMode {
  return width < MOBILE_MAX_WIDTH_PX || height < MOBILE_MAX_HEIGHT_PX ? 'mobile' : 'desktop';
}

export interface ContainerLayoutMode {
  /** Null until the container reports a usable size. */
  mode: Readonly<Ref<LayoutMode | null>>;
  isResolved: Readonly<Ref<boolean>>;
  /** Switches shells without tearing down the session's stores. */
  toggle: () => void;
}

/**
 * Decides once which shell a container gets, then stops watching.
 *
 * Deliberately not reactive to later resizes: a shell that flips mid-session
 * would throw away the user's panel arrangement and interaction context every
 * time a window is dragged across the threshold. Re-deciding is an explicit act,
 * either from the host at init or from the user through {@link toggle}.
 */
export function useContainerLayoutMode(
  containerRef: Ref<HTMLElement | null>,
  preference: Ref<LayoutModePreference>,
): ContainerLayoutMode {
  const mode = ref<LayoutMode | null>(null);
  let observer: ResizeObserver | null = null;

  function stopObserving() {
    observer?.disconnect();
    observer = null;
  }

  function resolveFromElement(element: HTMLElement) {
    const { width, height } = element.getBoundingClientRect();
    // An iframe is routinely 0×0 for the first frame or two after insertion.
    // Deciding then would send every host straight to the mobile shell.
    if (width <= 0 || height <= 0) return false;

    mode.value = resolveLayoutModeForSize(width, height);
    return true;
  }

  watch(
    [preference, containerRef],
    ([nextPreference, element]) => {
      if (nextPreference !== 'auto') {
        stopObserving();
        mode.value = nextPreference;
        return;
      }

      if (mode.value || !element) return;
      if (resolveFromElement(element)) {
        stopObserving();
        return;
      }

      if (observer || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(() => {
        if (!containerRef.value) return;
        if (resolveFromElement(containerRef.value)) stopObserving();
      });
      observer.observe(element);
    },
    { immediate: true },
  );

  watch(mode, (next) => setLayoutModeOverride(next), { immediate: true });

  onScopeDispose(() => {
    stopObserving();
    setLayoutModeOverride(null);
  });

  return {
    mode,
    isResolved: computed(() => mode.value !== null),
    toggle() {
      stopObserving();
      mode.value = mode.value === 'mobile' ? 'desktop' : 'mobile';
    },
  };
}
