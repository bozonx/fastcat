import { onUnmounted } from 'vue';
import type { Ref } from 'vue';

/**
 * Blurs the focusable element (input or textarea) inside containerRef
 * when a pointerdown occurs outside the container.
 *
 * This is needed because preventDefault() on pointerdown in other
 * components (e.g. timeline ruler) suppresses the native mousedown/blur
 * behaviour, leaving inputs focused when clicking outside them.
 */
export function useBlurOnPointerDownOutside(containerRef: Ref<HTMLElement | null>) {
  function handler(event: PointerEvent) {
    const container = containerRef.value;
    if (!container) return;

    const target = event.target as Node | null;
    if (!target) return;

    // Do nothing if the click originated inside the component
    if (container.contains(target)) return;

    const focusable = container.querySelector('input, textarea') as HTMLElement | null;
    if (!focusable) return;

    if (focusable === document.activeElement) {
      focusable.blur();
    }
  }

  document.addEventListener('pointerdown', handler, true);
  onUnmounted(() => {
    document.removeEventListener('pointerdown', handler, true);
  });
}
