import { useNuxtApp } from 'nuxt/app';
import { getDndLabelKey } from '~/composables/dnd/dndPresentation';

const FILE_MANAGER_DRAGGING_CLASS = 'fastcat-file-manager-dragging';
const FILE_MANAGER_DRAG_COPY_CLASS = 'fastcat-file-manager-drag-copy';
const FILE_MANAGER_DRAG_MOVE_CLASS = 'fastcat-file-manager-drag-move';
const FILE_MANAGER_DRAG_CANCEL_CLASS = 'fastcat-file-manager-drag-cancel';
const FILE_MANAGER_DRAG_OVERLAY_ID = 'fastcat-file-manager-drag-overlay';
type FileManagerDragCursorOperation =
  | 'copy'
  | 'move'
  | 'cancel'
  | 'open-panel'
  | 'open-tab'
  | 'timeline-add';

let dragOverlay: HTMLDivElement | null = null;
let dragOverlayIcon: HTMLSpanElement | null = null;
let dragOverlayLabel: HTMLSpanElement | null = null;
let overlayListenersRegistered = false;

function translateDragOperation(operation: FileManagerDragCursorOperation | null): string {
  const key = getDndLabelKey(operation ?? 'none');
  if (!key) return '';

  const _useNuxtApp =
    (globalThis as unknown as { useNuxtApp?: typeof useNuxtApp }).useNuxtApp || useNuxtApp;

  try {
    const nuxtApp = _useNuxtApp();
    const i18nService = nuxtApp.$i18nService as
      | { t?: (translationKey: string) => string }
      | undefined;
    return i18nService?.t?.(key) ?? key;
  } catch {
    return key;
  }
}

function getCursorStyle(operation: FileManagerDragCursorOperation | null): string {
  if (operation === 'copy') return 'copy';
  if (operation === 'cancel') return 'not-allowed';
  if (operation === 'move') return 'move';
  if (operation === 'open-panel' || operation === 'open-tab' || operation === 'timeline-add') {
    return 'copy';
  }
  return '';
}

function getOverlayMarkup(operation: FileManagerDragCursorOperation | null) {
  if (operation === 'copy') {
    return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v10H8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 10v6M10 13h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  if (operation === 'cancel') {
    return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 8 8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  if (operation === 'open-panel') {
    return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM15 5v14" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  if (operation === 'open-tab') {
    return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  if (operation === 'timeline-add') {
    return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M12 10v4M10 12h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h12M13 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function ensureDragOverlay() {
  if (typeof document === 'undefined') return null;
  if (dragOverlay && dragOverlay.isConnected) return dragOverlay;

  const overlay = document.createElement('div');
  overlay.id = FILE_MANAGER_DRAG_OVERLAY_ID;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.pointerEvents = 'none';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.gap = '4px';
  overlay.style.padding = '2px 6px';
  overlay.style.borderRadius = '999px';
  overlay.style.background = 'rgba(17, 20, 24, 0.92)';
  overlay.style.border = '1px solid rgba(255, 255, 255, 0.14)';
  overlay.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';
  overlay.style.color = '#fff';
  overlay.style.fontSize = '12px';
  overlay.style.fontWeight = '600';
  overlay.style.lineHeight = '1';
  overlay.style.whiteSpace = 'nowrap';
  overlay.style.setProperty('-webkit-font-smoothing', 'antialiased');

  dragOverlayIcon = document.createElement('span');
  dragOverlayIcon.style.display = 'inline-flex';
  dragOverlayIcon.style.alignItems = 'center';
  dragOverlayIcon.style.justifyContent = 'center';
  dragOverlayIcon.style.width = '16px';
  dragOverlayIcon.style.height = '16px';
  dragOverlayIcon.style.borderRadius = '999px';
  dragOverlayIcon.style.background = '#f59e0b';
  dragOverlayIcon.style.color = '#111418';
  dragOverlayIcon.style.lineHeight = '1';

  dragOverlayLabel = document.createElement('span');
  dragOverlayLabel.textContent = '';

  overlay.append(dragOverlayIcon, dragOverlayLabel);
  document.body.appendChild(overlay);
  dragOverlay = overlay;

  return overlay;
}

function updateDragOverlayOperation(operation: FileManagerDragCursorOperation | null) {
  const overlay = ensureDragOverlay();
  if (!overlay || !dragOverlayIcon || !dragOverlayLabel) return;

  dragOverlayIcon.innerHTML = getOverlayMarkup(operation);
  dragOverlayIcon.style.background =
    operation === 'copy' ||
    operation === 'open-panel' ||
    operation === 'open-tab' ||
    operation === 'timeline-add'
      ? '#22c55e'
      : operation === 'cancel'
        ? '#ef4444'
        : '#f59e0b';
  dragOverlayLabel.textContent = translateDragOperation(operation);
}

function updateDragOverlayPosition(x: number, y: number) {
  const overlay = ensureDragOverlay();
  if (!overlay) return;

  overlay.style.left = `${Math.round(x) + 14}px`;
  overlay.style.top = `${Math.round(y) + 10}px`;
}

function onGlobalDragOver(event: DragEvent) {
  if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
  updateDragOverlayPosition(event.clientX, event.clientY);
}

function registerOverlayListeners() {
  if (overlayListenersRegistered || typeof window === 'undefined') return;
  window.addEventListener('dragover', onGlobalDragOver, { capture: true });
  overlayListenersRegistered = true;
}

function unregisterOverlayListeners() {
  if (!overlayListenersRegistered || typeof window === 'undefined') return;
  window.removeEventListener('dragover', onGlobalDragOver, { capture: true });
  overlayListenersRegistered = false;
}

function updateClassList(
  target: HTMLElement,
  params: { isDragging: boolean; operation: FileManagerDragCursorOperation | null },
) {
  target.classList.toggle(FILE_MANAGER_DRAGGING_CLASS, params.isDragging);
  target.classList.toggle(
    FILE_MANAGER_DRAG_COPY_CLASS,
    params.isDragging && params.operation === 'copy',
  );
  target.classList.toggle(
    FILE_MANAGER_DRAG_MOVE_CLASS,
    params.isDragging && params.operation === 'move',
  );
  target.classList.toggle(
    FILE_MANAGER_DRAG_CANCEL_CLASS,
    params.isDragging && params.operation === 'cancel',
  );
  if (params.isDragging) {
    target.style.setProperty('cursor', getCursorStyle(params.operation), 'important');
  } else {
    target.style.removeProperty('cursor');
  }
}

export function syncFileManagerDragCursor(params: {
  isDragging: boolean;
  operation: FileManagerDragCursorOperation | null;
}) {
  if (typeof document === 'undefined') return;

  updateClassList(document.documentElement, params);
  updateClassList(document.body, params);

  const overlay = ensureDragOverlay();
  if (!overlay) return;

  updateDragOverlayOperation(params.operation);
  overlay.style.display = params.isDragging ? 'inline-flex' : 'none';

  if (params.isDragging) {
    registerOverlayListeners();
  } else {
    unregisterOverlayListeners();
  }
}

export function resetFileManagerDragCursor() {
  syncFileManagerDragCursor({ isDragging: false, operation: null });
}
