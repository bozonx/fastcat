import { normalizeWorkspaceFilePath, isWorkspaceCommonPath } from '../../utils/workspace-common';

const MAX_FS_ENTRY_NAME_BYTES = 255;
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

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
  if (new TextEncoder().encode(trimmed).byteLength > MAX_FS_ENTRY_NAME_BYTES) return false;
  // eslint-disable-next-line no-control-regex -- intentional check for control characters in filenames
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(trimmed)) return false;
  if (/[. ]$/.test(trimmed)) return false;
  const windowsBaseName = trimmed.split('.')[0]?.toUpperCase();
  if (windowsBaseName && RESERVED_WINDOWS_NAMES.has(windowsBaseName)) return false;
  return true;
}

export function assertValidFsEntryName(name: string): void {
  if (!isValidFsEntryName(name)) {
    throw new Error(`Invalid file or folder name: ${name}`);
  }
}

/**
 * Maximum traversal depth for recursive filesystem operations (copy, delete cleanup,
 * cross-VFS copy). 50 covers any realistic project layout and stops runaway recursion
 * from buggy adapters or symlink-style loops without artificially constraining users.
 */
export const MAX_TREE_TRAVERSAL_DEPTH = 50;

/** @deprecated Use MAX_TREE_TRAVERSAL_DEPTH — the constant is shared by copy and other recursive operations. */
export const MAX_COPY_DEPTH = MAX_TREE_TRAVERSAL_DEPTH;
