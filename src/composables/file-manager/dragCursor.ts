const FILE_MANAGER_DRAGGING_CLASS = 'fastcat-file-manager-dragging';
const FILE_MANAGER_DRAG_COPY_CLASS = 'fastcat-file-manager-drag-copy';
const FILE_MANAGER_DRAG_MOVE_CLASS = 'fastcat-file-manager-drag-move';
const FILE_MANAGER_DRAG_CANCEL_CLASS = 'fastcat-file-manager-drag-cancel';
const FILE_MANAGER_DRAG_OVERLAY_ID = 'fastcat-file-manager-drag-overlay';

let dragOverlay: HTMLDivElement | null = null;
let dragOverlayIcon: HTMLSpanElement | null = null;
let dragOverlayLabel: HTMLSpanElement | null = null;
let overlayListenersRegistered = false;

function getOverlayMarkup(operation: 'copy' | 'move' | 'cancel' | null) {
  if (operation === 'copy') return '+';
  if (operation === 'cancel') return 'x';
  return '^';
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

  dragOverlayIcon = document.createElement('span');
  dragOverlayIcon.style.display = 'inline-flex';
  dragOverlayIcon.style.alignItems = 'center';
  dragOverlayIcon.style.justifyContent = 'center';
  dragOverlayIcon.style.width = '16px';
  dragOverlayIcon.style.height = '16px';
  dragOverlayIcon.style.borderRadius = '999px';
  dragOverlayIcon.style.background = '#f59e0b';
  dragOverlayIcon.style.color = '#111418';
  dragOverlayIcon.style.fontSize = '12px';
  dragOverlayIcon.style.fontWeight = '700';

  dragOverlayLabel = document.createElement('span');
  dragOverlayLabel.textContent = 'Move';

  overlay.append(dragOverlayIcon, dragOverlayLabel);
  document.body.appendChild(overlay);
  dragOverlay = overlay;

  return overlay;
}

function updateDragOverlayOperation(operation: 'copy' | 'move' | 'cancel' | null) {
  const overlay = ensureDragOverlay();
  if (!overlay || !dragOverlayIcon || !dragOverlayLabel) return;

  dragOverlayIcon.textContent = getOverlayMarkup(operation);
  dragOverlayIcon.style.background =
    operation === 'copy' ? '#22c55e' : operation === 'cancel' ? '#ef4444' : '#f59e0b';
  dragOverlayLabel.textContent =
    operation === 'copy' ? 'Copy' : operation === 'cancel' ? 'Cancel' : 'Move';
}

function updateDragOverlayPosition(x: number, y: number) {
  const overlay = ensureDragOverlay();
  if (!overlay) return;

  overlay.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
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
  params: { isDragging: boolean; operation: 'copy' | 'move' | 'cancel' | null },
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
}

export function syncFileManagerDragCursor(params: {
  isDragging: boolean;
  operation: 'copy' | 'move' | 'cancel' | null;
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
