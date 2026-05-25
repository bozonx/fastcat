import { ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { FILE_MANAGER_ROOT_SPACER_HEIGHT } from '~/utils/constants';

export function useFileBrowserContainer() {
  const rootContainer = ref<HTMLElement | null>(null);
  const pendingScrollToEntryPath = ref<string | null>(null);
  const rootSpacerStyle = {
    width: '100%',
    minWidth: '100%',
    height: FILE_MANAGER_ROOT_SPACER_HEIGHT,
    flexShrink: 0,
  } as const;

  function setRootContainerRef(element: Element | ComponentPublicInstance | null) {
    rootContainer.value = element instanceof HTMLElement ? element : null;
  }

  function scrollToEntryPath(path: string): boolean {
    const container = rootContainer.value;
    if (!container) return false;
    const targetNode = container.querySelector<HTMLElement>(
      `[data-entry-path="${CSS.escape(path)}"]`,
    );
    if (!targetNode) return false;
    targetNode.scrollIntoView({ block: 'nearest' });
    return true;
  }

  return {
    rootContainer,
    pendingScrollToEntryPath,
    rootSpacerStyle,
    setRootContainerRef,
    scrollToEntryPath,
  };
}
