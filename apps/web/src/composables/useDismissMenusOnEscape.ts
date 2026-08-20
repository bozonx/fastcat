import { onUnmounted } from 'vue';

const REKA_MENU_CONTENT_SELECTOR = '[data-reka-menu-content]';

function createOutsidePointerEvent(): PointerEvent | MouseEvent {
  const eventInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
  };

  if (typeof PointerEvent === 'function') {
    return new PointerEvent('pointerdown', eventInit);
  }

  return new MouseEvent('pointerdown', eventInit);
}

export function hasOpenRekaMenu() {
  return document.querySelector(REKA_MENU_CONTENT_SELECTOR) !== null;
}

export function dismissOpenRekaMenus() {
  document.body.dispatchEvent(createOutsidePointerEvent());
}

export function dismissOpenRekaMenusOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Esc') return;
  if (!hasOpenRekaMenu()) return;

  event.preventDefault();
  event.stopPropagation();
  dismissOpenRekaMenus();
}

export function useDismissMenusOnEscape() {
  window.addEventListener('keydown', dismissOpenRekaMenusOnEscape, { capture: true });

  onUnmounted(() => {
    window.removeEventListener('keydown', dismissOpenRekaMenusOnEscape, { capture: true });
  });
}
