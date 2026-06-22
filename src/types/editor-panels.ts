import type { DynamicPanel } from '~/stores/editor-view.store';

export interface SplitResizeEvent {
  panes: Array<{ size: number }>;
}

/**
 * Events emitted by the editor panel system (Cut/Sound views and
 * `EditorDynamicPanelsView`). Centralizing this type removes duplicated
 * `defineEmits` declarations across the editor view wrappers.
 */
export interface EditorPanelEvents {
  topResize: [event: SplitResizeEvent];
  verticalResize: [
    event: SplitResizeEvent | Array<{ size: number }>,
    colId: string,
    view: 'cut' | 'sound',
  ];
  dragStart: [event: DragEvent, panelId: string];
  dragOver: [event: DragEvent, panelId: string, view: 'cut' | 'sound'];
  dragLeave: [event: DragEvent, panelId: string];
  drop: [event: DragEvent, panelId: string, view: 'cut' | 'sound'];
  dragEnd: [];
  focus: [panelId: string];
  close: [panel: DynamicPanel, view: 'cut' | 'sound'];
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
  topReset: [view: 'cut' | 'sound'];
  verticalReset: [colId: string, view: 'cut' | 'sound'];
  panelPointerDown: [event: PointerEvent, panelId: string, view: 'cut' | 'sound'];
}
