let lastTriggerButton: HTMLButtonElement | null = null;

const BLUR_DELAYS_MS = [0, 50, 100, 200];

function findButton(element: Element | null): HTMLButtonElement | null {
  if (!element) return null;
  if (element instanceof HTMLButtonElement) return element;
  return element.closest('button');
}

function blurButton(button: HTMLButtonElement | null) {
  if (button && document.activeElement === button) {
    button.blur();
  }
}

/**
 * Blurs the trigger button when a dropdown menu closes.
 * Use as `@update:open` handler on `UDropdownMenu`.
 *
 * Reka UI can restore focus to the trigger after it emits update:open,
 * so the blur is retried across a short window after close.
 */
export function blurOnDropdownMenuClose(isOpen: boolean) {
  if (isOpen) {
    lastTriggerButton = findButton(document.activeElement);
    return;
  }

  const triggerButton = lastTriggerButton;
  lastTriggerButton = null;

  for (const delay of BLUR_DELAYS_MS) {
    setTimeout(() => {
      blurButton(findButton(document.activeElement));
      blurButton(triggerButton);
    }, delay);
  }
}
