export type EditorView = 'files' | 'cut' | 'sound' | 'export' | 'fullscreen' | 'settings';

export interface DynamicPanel {
  id: string;
  type:
    | 'fileManager'
    | 'monitor'
    | 'properties'
    | 'text'
    | 'media'
    | 'history'
    | 'effects'
    | 'library'
    | 'markers'
    | 'backups';
  title?: string;
  filePath?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'unknown' | null;
}

export interface PanelColumn {
  id: string;
  panels: DynamicPanel[];
}

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

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
  focus: [panelId: string];
  close: [panel: DynamicPanel, view: 'cut' | 'sound'];
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
  topReset: [view: 'cut' | 'sound'];
  verticalReset: [colId: string, view: 'cut' | 'sound'];
  panelPointerDown: [event: PointerEvent, panelId: string, view: 'cut' | 'sound'];
}
