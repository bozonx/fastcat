import type { Ref } from 'vue';

export interface FocusableListNavigationOptions {
  containerRef: Ref<HTMLElement | null>;
  getColumnCount?: () => number;
  horizontal?: boolean;
}

function getFocusableItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));
}

function isTextInputElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
}

export function useFocusableListNavigation({
  containerRef,
  getColumnCount,
  horizontal = false,
}: FocusableListNavigationOptions) {
  function onKeyDown(event: KeyboardEvent) {
    const container = containerRef.value;
    if (!container) return;

    const activeEl = document.activeElement;
    if (isTextInputElement(activeEl)) return;

    const items = getFocusableItems(container);
    if (items.length === 0) return;

    const currentIndex = items.indexOf(activeEl as HTMLElement);
    const allowedKeys = horizontal
      ? ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']
      : ['ArrowDown', 'ArrowUp'];

    if (!allowedKeys.includes(event.key)) return;
    event.preventDefault();

    if (currentIndex === -1) {
      items[0]?.focus();
      return;
    }

    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight') {
      nextIndex = Math.min(currentIndex + 1, items.length - 1);
    } else if (event.key === 'ArrowLeft') {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else {
      const step = Math.max(getColumnCount?.() ?? 1, 1);
      nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(currentIndex + step, items.length - 1)
          : Math.max(currentIndex - step, 0);
    }

    if (nextIndex !== currentIndex) {
      items[nextIndex]?.focus();
    }
  }

  function moveSelection(dir: 'up' | 'down' | 'left' | 'right') {
    const keyMap: Record<string, string> = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
    };
    onKeyDown({
      key: keyMap[dir],
      preventDefault: () => {},
    } as KeyboardEvent);
  }

  return {
    onKeyDown,
    moveSelection,
  };
}
