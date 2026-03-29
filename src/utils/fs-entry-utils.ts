import type { FsEntry } from '~/types/fs';
import { VIDEO_EXTENSIONS } from '~/utils/media-types';

/**
 * Checks if a proxy is currently being generated for any direct child of the given directory.
 */
export function isGeneratingProxyInDirectory(
  entry: FsEntry,
  generatingProxies: Set<string> | string[],
): boolean {
  if (entry.kind !== 'directory') return false;
  const dirPath = entry.path;
  for (const p of generatingProxies) {
    if (!dirPath) {
      if (!p.includes('/')) return true;
    } else {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if any direct file children of a directory have a video extension.
 */
export function folderHasVideos(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const children = Array.isArray(entry.children) ? entry.children : [];
  return children.some(
    (child) =>
      child.kind === 'file' &&
      VIDEO_EXTENSIONS.includes(child.name.split('.').pop()?.toLowerCase() ?? ''),
  );
}
