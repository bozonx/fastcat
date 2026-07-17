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

  onMounted(() => {
    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onContextMenuOpen);
    window.addEventListener(CONTEXT_MENU_CLOSE_ALL_EVENT, closeContextMenu);
  });

  onScopeDispose(() => {
    window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onContextMenuOpen);
    window.removeEventListener(CONTEXT_MENU_CLOSE_ALL_EVENT, closeContextMenu);
  });

  return {
    isContextMenuOpen,
    setContextMenuOpen,
    closeContextMenu,
  };
}
