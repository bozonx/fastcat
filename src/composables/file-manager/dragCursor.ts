const FILE_MANAGER_DRAGGING_CLASS = 'fastcat-file-manager-dragging';
const FILE_MANAGER_DRAG_COPY_CLASS = 'fastcat-file-manager-drag-copy';
const FILE_MANAGER_DRAG_MOVE_CLASS = 'fastcat-file-manager-drag-move';

function updateClassList(
  target: HTMLElement,
  params: { isDragging: boolean; operation: 'copy' | 'move' | null },
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
}

export function syncFileManagerDragCursor(params: {
  isDragging: boolean;
  operation: 'copy' | 'move' | null;
}) {
  if (typeof document === 'undefined') return;

  updateClassList(document.documentElement, params);
  updateClassList(document.body, params);
}

export function resetFileManagerDragCursor() {
  syncFileManagerDragCursor({ isDragging: false, operation: null });
}
