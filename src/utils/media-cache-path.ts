import { normalizeProjectPath } from '~/utils/video-editor/worker-clip-utils';

export function normalizeMediaCachePath(path: string): string {
  if (!path) return path;
  if (path.startsWith('external:')) {
    return `external:${normalizeProjectPath(path.slice('external:'.length))}`;
  }
  return normalizeProjectPath(path);
}
