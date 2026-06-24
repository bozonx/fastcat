import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';
import { getBdPayload } from '~/types/bloggerdog';
import { getWorkspacePathParent } from '~/utils/workspace-common';
import type { FsEntry } from '~/types/fs';

export function getFileIcon(entry: FsEntry): string {
  const bd = getBdPayload(entry);
  if (bd?.type === 'content-item') return 'i-heroicons-document-text';
  if (entry.kind === 'directory') return 'i-heroicons-folder';
  if (entry.name.toLowerCase().endsWith('.otio')) return 'i-heroicons-queue-list';
  const type = getMediaTypeFromFilename(entry.name);
  return getIconForMediaType(type);
}

export function getParentPath(path?: string): string {
  return getWorkspacePathParent(path);
}
