import { normalizeProjectPath } from '~/utils/video-editor/worker-clip-utils';

/** Returns the parent directory portion of a `/`-separated path, or '' at the root. */
export function dirname(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

function normalizeSeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

function stripLeadingSeparators(path: string): string {
  return path.replace(/^\/+/, '');
}

function stripTrailingSeparators(path: string): string {
  if (path === '/') return path;
  if (/^[A-Za-z]:\/?$/.test(path)) return path.replace(/\/?$/, '/');
  return path.replace(/\/+$/, '');
}

/**
 * Joins path segments using native filesystem semantics (handles Windows drive
 * roots and back-slashes), normalising separators to `/`.
 */
export function joinTauriFsPath(...parts: string[]): string {
  const [first, ...rest] = parts.filter((part) => part.length > 0).map(normalizeSeparators);
  if (!first) return '';

  return rest.reduce((current, part) => {
    const next = stripLeadingSeparators(part).replace(/\/+$/, '');
    if (!next) return current;

    const base = stripTrailingSeparators(current);
    if (base === '/') return `/${next}`;
    if (/^[A-Za-z]:\/$/.test(base)) return `${base}${next}`;
    return `${base}/${next}`;
  }, first);
}

/**
 * Normalises a media path used as a cache key, preserving the `external:`
 * prefix while normalising the underlying project path.
 */
export function normalizeMediaCachePath(path: string): string {
  if (!path) return path;
  if (path.startsWith('external:')) {
    return `external:${normalizeProjectPath(path.slice('external:'.length))}`;
  }
  return normalizeProjectPath(path);
}
