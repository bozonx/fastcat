/**
 * Shared types for the pointer-based drag-and-drop engine.
 *
 * This engine replaces HTML5 native drag-and-drop (`draggable` + `dragstart` /
 * `dragover` / `drop` / `dragend`) for *internal* application drags. HTML5 DnD
 * does not work with touch/stylus and has unreliable `dragend` delivery in
 * WebKitGTK (Tauri); pointer events unify mouse/touch/pen and always deliver a
 * terminal `pointerup`/`pointercancel`.
 *
 * OS <-> app drags (dropping a file from the OS file manager into the window)
 * are NOT handled here — those remain on the native HTML5 / Tauri
 * `onDragDropEvent` path, because the OS owns that drag.
 */

/** Logical operation currently resolved for the active drag. Drives the cursor/badge. */
export type DndOperation =
  | 'copy'
  | 'move'
  | 'cancel'
  | 'timeline-add'
  | 'open-panel'
  | 'open-tab'
  | 'effect'
  | 'transition'
  | 'none';

/** Which feature initiated the drag. Consumers narrow `payload.data` by this. */
export type DndSourceKind =
  | 'file-manager'
  | 'timeline-toolbar'
  | 'effect'
  | 'transition'
  | 'library'
  | 'panel'
  | 'project-tab';

export type DndPointerType = 'mouse' | 'touch' | 'pen' | '';

/** Optional, source-agnostic hint for the drag ghost (what is being dragged). */
export interface DndPreview {
  label?: string;
  /** When dragging multiple items, the total count (renders a "+N" badge). */
  count?: number;
}

export interface DndPayload<T = unknown> {
  source: DndSourceKind;
  /** Generic payload; consumers cast based on `source`. */
  data: T;
  /** Visual hint for the ghost layer. Decoupled from `data` so the ghost stays generic. */
  preview?: DndPreview;
}

/** Snapshot of the pointer + modifier keys at the current frame of the drag. */
export interface DndPointer {
  clientX: number;
  clientY: number;
  pointerType: DndPointerType;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Context passed to drop-zone handlers on every enter/over/leave/drop. */
export interface DndDragContext {
  payload: DndPayload;
  pointer: DndPointer;
  zoneId: string;
  /** Topmost element under the pointer (the hit-test result). */
  targetEl: Element | null;
  /** Sets the resolved operation (drives cursor/badge). Zones call this in onOver. */
  setOperation: (operation: DndOperation) => void;
}

export interface DndDropZoneHandlers {
  /** Optional gate: if it returns false the zone is treated as not present. */
  canAccept?: (payload: DndPayload) => boolean;
  onEnter?: (ctx: DndDragContext) => void;
  onOver?: (ctx: DndDragContext) => void;
  onLeave?: (ctx: DndDragContext) => void;
  onDrop?: (ctx: DndDragContext) => void | Promise<void>;
}
