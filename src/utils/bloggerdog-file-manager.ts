import { getBdPayload, type BdEntryType } from '~/types/bloggerdog';
import type { FileManagerClipboardItem } from '~/stores/clipboard.store';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';

function getBloggerDogEntryType(entry: FsEntry | null | undefined): BdEntryType | null {
  return getBdPayload(entry ?? {})?.type ?? null;
}

export function isBloggerDogEntry(entry: FsEntry | null | undefined): boolean {
  return getBloggerDogEntryType(entry) !== null;
}

export function isBloggerDogVirtualFolder(entry: FsEntry | null | undefined): boolean {
  return getBloggerDogEntryType(entry) === 'virtual-folder';
}

export function isBloggerDogProject(entry: FsEntry | null | undefined): boolean {
  return getBloggerDogEntryType(entry) === 'project';
}

export function isBloggerDogGroup(entry: FsEntry | null | undefined): boolean {
  return getBloggerDogEntryType(entry) === 'collection';
}

export function isBloggerDogContentItem(entry: FsEntry | null | undefined): boolean {
  return getBloggerDogEntryType(entry) === 'content-item';
}

export function isBloggerDogMediaEntry(entry: FsEntry | null | undefined): boolean {
  const payload = getBdPayload(entry ?? {});
  return payload?.type === 'media' && Boolean(payload.mediaId);
}

export function isBloggerDogTextWrapper(entry: FsEntry | null | undefined): boolean {
  const payload = getBdPayload(entry ?? {});
  return payload?.type === 'media' && !payload.mediaId;
}

export function isBloggerDogPersonalLibraryRoot(entry: FsEntry | null | undefined): boolean {
  return isBloggerDogVirtualFolder(entry) && entry?.remoteId === 'personal';
}

export function isBloggerDogAllContentRoot(entry: FsEntry | null | undefined): boolean {
  return isBloggerDogVirtualFolder(entry) && entry?.remoteId === 'virtual-all';
}

export function isBloggerDogProjectLibrariesRoot(entry: FsEntry | null | undefined): boolean {
  return isBloggerDogVirtualFolder(entry) && entry?.remoteId === 'projects';
}

export function canCopyCutBloggerDogEntry(entry: FsEntry | null | undefined): boolean {
  if (!isBloggerDogEntry(entry)) return true;
  return isBloggerDogMediaEntry(entry) || isBloggerDogTextWrapper(entry);
}

export function canPasteIntoBloggerDogEntry(entry: FsEntry | null | undefined): boolean {
  return isBloggerDogContentItem(entry);
}

export function canCreateSubgroupInBloggerDogEntry(entry: FsEntry | null | undefined): boolean {
  return (
    isBloggerDogGroup(entry) ||
    isBloggerDogProject(entry) ||
    isBloggerDogPersonalLibraryRoot(entry)
  );
}

export function canCreateContentItemInBloggerDogEntry(entry: FsEntry | null | undefined): boolean {
  return (
    isBloggerDogGroup(entry) ||
    isBloggerDogProject(entry) ||
    isBloggerDogPersonalLibraryRoot(entry) ||
    isBloggerDogAllContentRoot(entry)
  );
}

export function isMediaFileName(name: string | null | undefined): boolean {
  if (!name) return false;
  const mediaType = getMediaTypeFromFilename(name);
  return mediaType === 'video' || mediaType === 'audio' || mediaType === 'image';
}

export function canTransferClipboardItemToOrFromBloggerDog(
  item: Pick<FileManagerClipboardItem, 'kind' | 'name'> | null | undefined,
): boolean {
  return item?.kind === 'file' && isMediaFileName(item.name);
}

export function canTransferFsEntryToOrFromBloggerDog(entry: FsEntry | null | undefined): boolean {
  if (!entry || entry.kind !== 'file') return false;

  if (isBloggerDogEntry(entry)) {
    return isBloggerDogMediaEntry(entry);
  }

  return isMediaFileName(entry.name);
}

function getParentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

export function normalizeBloggerDogTextWrapperTitle(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().endsWith('.txt')) {
    return trimmed.slice(0, -4).trim();
  }
  return trimmed;
}

export function getBloggerDogTextWrapperRenameResult(entry: FsEntry, nextName: string): {
  reloadDirPath: string;
  newPath: string;
} {
  const itemPath = entry.parentPath ?? getParentPath(entry.path);
  const reloadDirPath = getParentPath(itemPath);
  const title = normalizeBloggerDogTextWrapperTitle(nextName);
  const nextItemPath = reloadDirPath ? `${reloadDirPath}/${title}` : title;

  return {
    reloadDirPath,
    newPath: `${nextItemPath}/${title}.txt`,
  };
}
