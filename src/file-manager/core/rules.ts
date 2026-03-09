import { normalizeWorkspaceFilePath, isWorkspaceCommonPath } from '../../utils/workspace-common';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  const source = normalizeWorkspaceFilePath(params.sourcePath);
  const target = normalizeWorkspaceFilePath(params.targetDirPath);

  if (!source) return true;
  if (!target) return true;

  if (isWorkspaceCommonPath(source) !== isWorkspaceCommonPath(target)) {
    return true;
  }

  if (target === source) return false;
  if (target.startsWith(`${source}/`)) return false;
  return true;
}
