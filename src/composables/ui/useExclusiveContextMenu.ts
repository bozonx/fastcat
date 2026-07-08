import { onMounted, onScopeDispose, ref } from 'vue';

interface ContextMenuOpenDetail {
  id: symbol;
}

const CONTEXT_MENU_OPEN_EVENT = 'fastcat:context-menu-open';

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
  });

  onScopeDispose(() => {
    window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onContextMenuOpen);
  });

  return {
    isContextMenuOpen,
    setContextMenuOpen,
    closeContextMenu,
  };
}
