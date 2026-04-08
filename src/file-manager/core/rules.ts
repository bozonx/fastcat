import { normalizeWorkspaceFilePath, isWorkspaceCommonPath } from '../../utils/workspace-common';

function isDescendantOrSelf(params: { sourcePath: string; targetDirPath: string }): boolean {
  const source = normalizeWorkspaceFilePath(params.sourcePath);
  const target = normalizeWorkspaceFilePath(params.targetDirPath);

  if (!source || !target) return false;
  if (isWorkspaceCommonPath(source) !== isWorkspaceCommonPath(target)) return false;
  if (target === source) return true;
  if (target.startsWith(`${source}/`)) return true;
  return false;
}

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return !isDescendantOrSelf(params);
}

export function isCopyAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return !isDescendantOrSelf(params);
}

export const MAX_COPY_DEPTH = 50;
