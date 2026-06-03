import { defineNuxtPlugin } from '#app';

export default defineNuxtPlugin(() => {
  if (import.meta.server) return;

  // Listen to global click events on the document
  document.addEventListener('click', (event) => {
    // Find the closest interactive button element
    const button = (event.target as HTMLElement).closest('button, [role="button"]');
    if (!button) return;

    // Do not blur on keyboard click events to preserve Tab navigation accessibility.
    // PointerEvent.pointerType is empty for keyboard-triggered click events.
    if (event instanceof PointerEvent && !event.pointerType) {
      return;
    }

    // Exclude dropdowns, selects, tabs, and sliders which require focus to work.
    const isExcluded =
      button.hasAttribute('aria-haspopup') ||
      button.getAttribute('aria-expanded') !== null ||
      button.closest('[aria-haspopup]') !== null ||
      button.closest('[role="tablist"]') !== null ||
      button.getAttribute('role') === 'tab' ||
      button.getAttribute('role') === 'slider';

    if (isExcluded) return;

    // Remove focus immediately
    (button as HTMLElement).blur();
  });
});
