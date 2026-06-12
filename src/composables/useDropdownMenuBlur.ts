/**
 * Blurs the trigger button when a dropdown menu closes.
 * Use as `@update:open` handler on `UDropdownMenu`.
 *
 * Uses a small setTimeout because Reka UI returns focus to the
 * trigger asynchronously after emitting update:open, so nextTick
 * is not enough.
 */
export function blurOnDropdownMenuClose(isOpen: boolean) {
  if (!isOpen) {
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'BUTTON' || active.closest('button'))) {
        active.blur();
      }
    }, 50);
  }
}
