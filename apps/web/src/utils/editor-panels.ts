import type { EditorPanelEvents, SplitResizeEvent } from '~/types/editor-panels';

export type EditorPanelEventListenerMap = {
  [K in keyof EditorPanelEvents]: (...args: EditorPanelEvents[K]) => void;
};

/**
 * Creates a map of typed event listeners that forward every editor panel event
 * through the provided emit function. Useful for thin wrapper components that
 * need to re-emit events from `EditorDynamicPanelsView`.
 */
export function createEditorPanelEventListeners(
  emit: <E extends keyof EditorPanelEvents>(event: E, ...args: EditorPanelEvents[E]) => void,
): EditorPanelEventListenerMap {
  return {
    topResize: (event: SplitResizeEvent) => {
      emit('topResize', event);
    },
    verticalResize: (
      event: SplitResizeEvent | Array<{ size: number }>,
      colId: string,
      view: 'cut' | 'sound',
    ) => {
      emit('verticalResize', event, colId, view);
    },
    focus: (panelId: string) => {
      emit('focus', panelId);
    },
    close: (panel, view) => {
      emit('close', panel, view);
    },
    moveToView: (panel, view) => {
      emit('moveToView', panel, view);
    },
    topReset: (view: 'cut' | 'sound') => {
      emit('topReset', view);
    },
    verticalReset: (colId: string, view: 'cut' | 'sound') => {
      emit('verticalReset', colId, view);
    },
    panelPointerDown: (event: PointerEvent, panelId: string, view: 'cut' | 'sound') => {
      emit('panelPointerDown', event, panelId, view);
    },
  };
}
