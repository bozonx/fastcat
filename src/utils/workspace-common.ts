export const WORKSPACE_COMMON_DIR_NAME = 'common';
export const WORKSPACE_COMMON_PATH_PREFIX = '@common';

/**
 * VFS path prefix that addresses a *specific* project by name, regardless of
 * which project is currently active. Routed (see `buildVfsRoutes`) to the
 * workspace adapter under `projects/<name>/…`.
 *
 * The default (unprefixed) route always targets the *active* project, so this
 * prefix is only needed when operating on a project that is not yet active
 * (e.g. writing initial settings while creating a new project).
 */
export const WORKSPACE_PROJECT_PATH_PREFIX = '@project';

/** Build a VFS path addressing `relPath` inside the named project's directory. */
export function toProjectStoragePath(projectName: string, relPath = ''): string {
  const rel = normalizeWorkspaceFilePath(relPath);
  const base = `${WORKSPACE_PROJECT_PATH_PREFIX}/${projectName}`;
  return rel ? `${base}/${rel}` : base;
}

function isWorkspaceCommonPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isWorkspaceCommonPath(path?: string | null): boolean {
  if (!path) return false;
  return isWorkspaceCommonPrefix(path, WORKSPACE_COMMON_PATH_PREFIX);
}

export function stripWorkspaceCommonPathPrefix(path: string): string {
  if (!isWorkspaceCommonPath(path)) return normalizeWorkspaceFilePath(path);
  if (path === WORKSPACE_COMMON_PATH_PREFIX) return '';

  return path.slice(`${WORKSPACE_COMMON_PATH_PREFIX}/`.length);
}

export function toWorkspaceCommonPath(path?: string | null): string {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  if (!normalized || normalized === WORKSPACE_COMMON_PATH_PREFIX)
    return WORKSPACE_COMMON_PATH_PREFIX;
  if (isWorkspaceCommonPath(normalized)) return normalized;
  return `${WORKSPACE_COMMON_PATH_PREFIX}/${normalized}`;
}

export function toWorkspaceCommonStoragePath(path?: string | null): string {
  const normalized = toWorkspaceCommonPath(path);
  if (normalized === WORKSPACE_COMMON_PATH_PREFIX) return WORKSPACE_COMMON_DIR_NAME;

  const relative = stripWorkspaceCommonPathPrefix(normalized);
  return relative ? `${WORKSPACE_COMMON_DIR_NAME}/${relative}` : WORKSPACE_COMMON_DIR_NAME;
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

export function isProjectVideoPath(path?: string | null): boolean {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  return (
    normalized.startsWith('_video/') ||
    normalized.startsWith(`${WORKSPACE_COMMON_PATH_PREFIX}/_video/`)
  );
}

export function isProjectAudioPath(path?: string | null): boolean {
  const normalized = normalizeWorkspaceFilePath(path ?? '');
  return (
    normalized.startsWith('_audio/') ||
    normalized.startsWith(`${WORKSPACE_COMMON_PATH_PREFIX}/_audio/`)
  );
}
