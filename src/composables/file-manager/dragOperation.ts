export interface ResolveFileManagerDragOperationParams {
  dragSourceFileManagerInstanceId?: string | null;
  isLayer1Active: boolean;
  isSameFileSystem?: boolean | null;
  targetFileManagerInstanceId?: string | null;
}

export interface FileManagerDraggedItem {
  path?: unknown;
  kind?: unknown;
  name?: unknown;
}

export type FileManagerDragCursorOperation =
  'copy' | 'move' | 'cancel' | 'open-panel' | 'open-tab' | 'timeline-add';

export interface ResolveFileManagerDropOperationParams extends ResolveFileManagerDragOperationParams {
  currentDragOperation?: FileManagerDragCursorOperation | null;
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
  if (isCrossFileManagerDrag(params) && params.isSameFileSystem === false) {
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

  if (params.currentDragOperation === 'copy' || params.currentDragOperation === 'move') {
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
  const targetEntryPath = typeof params.targetEntryPath === 'string' ? params.targetEntryPath : '';
  if (params.items.length === 0) return false;
  if (!targetEntryPath) return false;

  return params.items.every((item) => {
    const sourcePath = typeof item?.path === 'string' ? item.path : '';
    if (!sourcePath) return false;
    return sourcePath === targetEntryPath;
  });
}

export function shouldCancelFileManagerDropToDirectory(params: {
  items: Array<{ path?: unknown }>;
  targetDirPath?: string | null;
}): boolean {
  const targetDirPath = typeof params.targetDirPath === 'string' ? params.targetDirPath : '';
  if (params.items.length === 0) return false;

  return params.items.every((item) => {
    const sourcePath = typeof item?.path === 'string' ? item.path : '';
    if (!sourcePath) return false;

    const normalizedSourcePath = sourcePath.replace(/\/+$/, '');
    const lastSlashIndex = normalizedSourcePath.lastIndexOf('/');
    const sourceParentPath =
      lastSlashIndex >= 0 ? normalizedSourcePath.slice(0, lastSlashIndex) : '';

    return sourceParentPath === targetDirPath;
  });
}

/**
 * The pointer-DnD engine hit-tests `elementFromPoint` and hands us the topmost
 * element, so we walk up to the nearest `[data-entry-path]`. Kept structural
 * (only `getAttribute`/`parentElement`) so it is unit-testable without a real
 * DOM.
 */
export function getDropTargetEntryPathFromEl(
  el: { getAttribute?(name: string): string | null; parentElement?: unknown } | null,
): string | null {
  let node = el;
  while (node) {
    const path = node.getAttribute?.('data-entry-path') ?? null;
    if (typeof path === 'string' && path.length > 0) return path;
    node = (node.parentElement ?? null) as typeof node;
  }
  return null;
}

export function isCancellationZone(params: {
  items: FileManagerDraggedItem[];
  targetEntryPath?: string | null;
  targetDirPath?: string | null;
}): boolean {
  if (params.items.length === 0) return false;

  return (
    shouldCancelFileManagerDrop({
      items: params.items,
      targetEntryPath: params.targetEntryPath,
    }) ||
    shouldCancelFileManagerDropToDirectory({
      items: params.items,
      targetDirPath: params.targetDirPath,
    })
  );
}
