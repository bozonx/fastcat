import { nextTick } from 'vue';

/**
 * Blurs the trigger button when a dropdown menu closes.
 * Use as `@update:open` handler on `UDropdownMenu`.
 */
export function blurOnDropdownMenuClose(isOpen: boolean) {
  if (!isOpen) {
    void nextTick(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'BUTTON' || active.closest('button'))) {
        active.blur();
      }
    });
  }
}
