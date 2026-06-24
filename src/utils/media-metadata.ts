import { normalizeMediaCachePath } from '~/utils/path';

export function resolveMediaMetadataEntry<T>(
  mediaMetadata: Record<string, T | undefined>,
  path: string,
): T | undefined {
  if (!path) return undefined;
  const direct = mediaMetadata[path];
  if (direct) return direct;
  const normalized = normalizeMediaCachePath(path);
  if (normalized !== path && mediaMetadata[normalized]) {
    return mediaMetadata[normalized];
  }
  if (path.startsWith('external:')) {
    const clean = path.slice('external:'.length);
    return mediaMetadata[clean];
  }
  const prefixed = `external:${path}`;
  return mediaMetadata[prefixed];
}
