import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';

export interface ResolveFileManagerDragOperationParams {
  dragSourceFileManagerInstanceId?: string | null;
  isLayer1Active: boolean;
  targetFileManagerInstanceId?: string | null;
}

export interface FileManagerDraggedItem {
  path?: unknown;
  kind?: unknown;
}

export type FileManagerDragCursorOperation = 'copy' | 'move' | 'cancel';

export interface ResolveFileManagerDropOperationParams
  extends ResolveFileManagerDragOperationParams {
  currentDragOperation?: 'copy' | 'move' | null;
  fallbackRawOperation?: 'copy' | 'move' | null;
}

export function isCrossFileManagerDrag(
  params: Pick<
    ResolveFileManagerDragOperationParams,
    'dragSourceFileManagerInstanceId' | 'targetFileManagerInstanceId'
  >,
): boolean {
  return Boolean(
    params.dragSourceFileManagerInstanceId &&
      params.targetFileManagerInstanceId &&
      params.dragSourceFileManagerInstanceId !== params.targetFileManagerInstanceId,
  );
}

export function resolveFileManagerDragOperation(
  params: ResolveFileManagerDragOperationParams,
): 'copy' | 'move' {
  if (isCrossFileManagerDrag(params)) {
    return params.isLayer1Active ? 'move' : 'copy';
  }

  return params.isLayer1Active ? 'copy' : 'move';
}

export function resolveFileManagerDropOperation(
  params: ResolveFileManagerDropOperationParams,
): 'copy' | 'move' {
  if (params.dragSourceFileManagerInstanceId && params.targetFileManagerInstanceId) {
    return resolveFileManagerDragOperation(params);
  }

  if (params.currentDragOperation) {
    return params.currentDragOperation;
  }

  if (params.fallbackRawOperation) {
    return params.fallbackRawOperation;
  }

  return params.isLayer1Active ? 'copy' : 'move';
}

export function shouldCancelFileManagerDrop(params: {
  items: Array<{ path?: unknown }>;
  targetEntryPath?: string | null;
}): boolean {
  const targetEntryPath =
    typeof params.targetEntryPath === 'string' ? params.targetEntryPath : '';
  if (params.items.length === 0) return false;
  if (!targetEntryPath) return false;

  return params.items.every((item) => {
    const sourcePath = typeof item?.path === 'string' ? item.path : '';
    if (!sourcePath) return false;
    return sourcePath === targetEntryPath;
  });
}

export function getDropTargetEntryPath(event: DragEvent): string | null {
  const hasHTMLElement = typeof HTMLElement !== 'undefined';
  const readDatasetPath = (value: unknown): string | null => {
    if (!value || typeof value !== 'object') return null;
    const dataset = (value as { dataset?: { entryPath?: unknown } }).dataset;
    return typeof dataset?.entryPath === 'string' && dataset.entryPath.length > 0
      ? dataset.entryPath
      : null;
  };
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (hasHTMLElement && node instanceof HTMLElement) {
      const entryPath = readDatasetPath(node);
      if (entryPath) return entryPath;
    } else {
      const entryPath = readDatasetPath(node);
      if (entryPath) return entryPath;
    }
  }

  const target = event.target as
    | (EventTarget & { closest?: (selector: string) => unknown; dataset?: { entryPath?: unknown } })
    | null;

  const directEntryPath = readDatasetPath(target);
  if (directEntryPath) {
    return directEntryPath;
  }

  if (target && typeof target.closest === 'function') {
    const container = target.closest('[data-entry-path]');
    const entryPath = readDatasetPath(container);
    if (entryPath) {
      return entryPath;
    }
  }

  return null;
}

export function getDraggedFileManagerItems(event: DragEvent): FileManagerDraggedItem[] {
  const copyRaw = event.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
  const moveRaw = event.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
  const internalRaw = copyRaw || moveRaw;
  if (!internalRaw) return [];

  try {
    const parsed: unknown = JSON.parse(internalRaw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function isFileManagerDropCancellationTarget(params: {
  event: DragEvent;
  targetEntryPath?: string | null;
}): boolean {
  return shouldCancelFileManagerDrop({
    items: getDraggedFileManagerItems(params.event),
    targetEntryPath: params.targetEntryPath,
  });
}
