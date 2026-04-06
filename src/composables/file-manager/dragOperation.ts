export interface ResolveFileManagerDragOperationParams {
  dragSourceFileManagerInstanceId?: string | null;
  isLayer1Active: boolean;
  targetFileManagerInstanceId?: string | null;
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
