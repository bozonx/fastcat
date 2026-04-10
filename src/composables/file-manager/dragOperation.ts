export interface ResolveFileManagerDragOperationParams {
  dragSourceFileManagerInstanceId?: string | null;
  isLayer1Active: boolean;
  targetFileManagerInstanceId?: string | null;
}

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
