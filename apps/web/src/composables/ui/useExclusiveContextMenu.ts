import { onMounted, onScopeDispose, ref } from 'vue';

interface ContextMenuOpenDetail {
  id: symbol;
}

const CONTEXT_MENU_OPEN_EVENT = 'fastcat:context-menu-open';
const CONTEXT_MENU_CLOSE_ALL_EVENT = 'fastcat:context-menu-close-all';

/**
 * Event dispatched to force-close every open context menu. Used when a pointer
 * interaction that should dismiss menus is swallowed by `stopPropagation`
 * before it can reach a menu's own outside-dismiss layer — e.g. taps inside the
 * timeline panel, whose pointerdown handlers stop propagation and so never
 * reach the Reka `DismissableLayer` on `document`.
 */
export const CONTEXT_MENU_CLOSE_ALL_EVENT_NAME = CONTEXT_MENU_CLOSE_ALL_EVENT;

/** Broadcast a request to close every open context menu. */
export function closeAllContextMenus() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CONTEXT_MENU_CLOSE_ALL_EVENT));
}

export function useExclusiveContextMenu() {
  const id = Symbol('context-menu');
  const isContextMenuOpen = ref(false);

  function closeContextMenu() {
    isContextMenuOpen.value = false;
  }

  function setContextMenuOpen(open: boolean) {
    if (open) {
      window.dispatchEvent(
        new CustomEvent<ContextMenuOpenDetail>(CONTEXT_MENU_OPEN_EVENT, {
          detail: { id },
        }),
      );
    }

    isContextMenuOpen.value = open;
  }

  function onContextMenuOpen(event: Event) {
    const detail = (event as CustomEvent<ContextMenuOpenDetail>).detail;
    if (detail?.id !== id) {
      closeContextMenu();
    }
  }

  /**
   * Close on any pointerdown that lands outside the open menu's content. Runs on
   * `window` in the capture phase so it fires even when Reka's `UContextMenu`
   * teleports a full-screen overlay that swallows the tap (its own touch
   * outside-dismiss is unreliable, unlike a button-triggered `UDropdownMenu`).
   * Taps on the menu itself (Reka content carries `role="menu"`) are ignored so
   * item selection still runs before the menu closes through its normal flow.
   */
  function onGlobalPointerDownCapture(event: PointerEvent) {
    if (!isContextMenuOpen.value) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[role="menu"]')) return;
    closeContextMenu();
  }

  onMounted(() => {
    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onContextMenuOpen);
    window.addEventListener(CONTEXT_MENU_CLOSE_ALL_EVENT, closeContextMenu);
    window.addEventListener('pointerdown', onGlobalPointerDownCapture, { capture: true });
  });

  onScopeDispose(() => {
    window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onContextMenuOpen);
    window.removeEventListener(CONTEXT_MENU_CLOSE_ALL_EVENT, closeContextMenu);
    window.removeEventListener('pointerdown', onGlobalPointerDownCapture, { capture: true });
  });

  return {
    isContextMenuOpen,
    setContextMenuOpen,
    closeContextMenu,
  };
}
