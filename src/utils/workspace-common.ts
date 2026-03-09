export const WORKSPACE_COMMON_DIR_NAME = 'common';
export const WORKSPACE_COMMON_PATH_PREFIX = '@common';

export function isWorkspaceCommonPath(path?: string | null): boolean {
  if (!path) return false;
  return (
    path === WORKSPACE_COMMON_PATH_PREFIX || path.startsWith(`${WORKSPACE_COMMON_PATH_PREFIX}/`)
  );
}

export function stripWorkspaceCommonPathPrefix(path: string): string {
  if (!isWorkspaceCommonPath(path)) return normalizeWorkspaceFilePath(path);
  if (path === WORKSPACE_COMMON_PATH_PREFIX) return '';
  return path.slice(`${WORKSPACE_COMMON_PATH_PREFIX}/`.length);
}

export function toWorkspaceCommonPath(path?: string | null): string {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  if (!normalized) return WORKSPACE_COMMON_PATH_PREFIX;
  return `${WORKSPACE_COMMON_PATH_PREFIX}/${normalized}`;
}

export function normalizeWorkspaceFilePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';

  if (isWorkspaceCommonPath(trimmed)) {
    const relative = trimmed
      .slice(WORKSPACE_COMMON_PATH_PREFIX.length)
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/');

    return relative ? `${WORKSPACE_COMMON_PATH_PREFIX}/${relative}` : WORKSPACE_COMMON_PATH_PREFIX;
  }

  return trimmed
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

export function getWorkspacePathParent(path?: string | null): string {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  if (!normalized) return '';
  if (normalized === WORKSPACE_COMMON_PATH_PREFIX) return '';

  const parts = normalized.split('/');
  if (parts.length <= 1) return '';

  return parts.slice(0, -1).join('/');
}

export function getWorkspacePathFileName(path?: string | null): string {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  if (!normalized) return '';
  return normalized.split('/').pop() ?? normalized;
}
