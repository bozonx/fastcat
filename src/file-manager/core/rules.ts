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

export function isValidFsEntryName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(trimmed)) return false;
  if (/[. ]$/.test(trimmed)) return false;
  return true;
}

export function assertValidFsEntryName(name: string): void {
  if (!isValidFsEntryName(name)) {
    throw new Error(`Invalid file or folder name: ${name}`);
  }
}

export const MAX_COPY_DEPTH = 50;
