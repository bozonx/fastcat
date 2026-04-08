import type { FsEntry } from '~/types/fs';
import type {
  RemoteVfsDirectoryEntry,
  RemoteVfsEntry,
  RemoteVfsFileEntry,
  RemoteVfsHealthResponse,
  RemoteVfsListResponse,
  RemoteVfsMedia,
} from '~/types/remote-vfs';

export interface RemoteFsEntry extends FsEntry {
  source: 'remote';
  remoteId: string;
  remotePath: string;
  remoteType: 'file' | 'directory';
  remoteData: RemoteVfsEntry;
  size?: number;
  mimeType?: string;
  created?: number;
  objectUrl?: string;
}

export interface RemoteVfsClientConfig {
  baseUrl: string;
  bearerToken: string;
}

export interface RemoteVfsProgressCallbacks {
  onProgress?: (progress: number) => void;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function joinPath(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`;
}

function normalizeFileName(value: string): string {
  return value.trim().replace(/[\\/]+/g, '-');
}

export function getRemoteEntryDisplayName(entry: Pick<RemoteVfsEntry, 'name' | 'title'>): string {
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  return title || name || 'Untitled';
}

export function getRemoteMediaDisplayName(params: {
  entry: Pick<RemoteVfsFileEntry, 'name' | 'title'>;
  media: RemoteVfsMedia;
  mediaIndex?: number;
}): string {
  const mediaFilename = typeof params.media.filename === 'string' ? params.media.filename.trim() : '';
  const mediaTitle = typeof params.media.title === 'string' ? params.media.title.trim() : '';
  const mediaName = typeof params.media.name === 'string' ? params.media.name.trim() : '';

  if (mediaFilename) return normalizeFileName(mediaFilename);
  if (mediaTitle) return normalizeFileName(mediaTitle);
  if (mediaName) return normalizeFileName(mediaName);

  const itemName = getRemoteEntryDisplayName(params.entry);
  const extensionFromMime = params.media.mimeType?.split('/').pop()?.toLowerCase() ?? '';
  const extension =
    extensionFromMime && extensionFromMime !== 'plain' ? `.${extensionFromMime}` : '';
  return normalizeFileName(`${itemName}-${(params.mediaIndex ?? 0) + 1}${extension}`);
}

export function getRemoteMediaKind(
  media: RemoteVfsMedia,
): 'video' | 'audio' | 'image' | 'text' | 'document' | 'unknown' {
  const mimeType = media.mimeType?.toLowerCase() ?? '';
  const mediaType = media.type?.toLowerCase() ?? '';

  if (mimeType.startsWith('video/') || mediaType.includes('video')) return 'video';
  if (mimeType.startsWith('audio/') || mediaType.includes('audio')) return 'audio';
  if (mimeType.startsWith('image/') || mediaType.includes('image')) return 'image';
  if (mimeType.startsWith('text/') || mediaType.includes('text')) return 'text';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mediaType.includes('document')) {
    return 'document';
  }

  return 'unknown';
}

function resolveMediaMimeType(media: RemoteVfsMedia[] | undefined): string {
  return media?.[0]?.mimeType || 'application/octet-stream';
}

function resolveMediaSize(entry: RemoteVfsEntry): number {
  if (entry.type !== 'file') return 0;
  return entry.media?.[0]?.size ?? 0;
}

function getRemoteEntryUpdatedAt(entry: RemoteVfsEntry): number | undefined {
  if (entry.type !== 'file') return undefined;
  const raw = (entry.meta?.updatedAt ?? entry.meta?.createdAt ?? entry.meta?.date) as
    | string
    | number
    | undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const value = Date.parse(raw);
    return Number.isNaN(value) ? undefined : value;
  }
  return undefined;
}

export function toRemoteFsEntry(entry: RemoteVfsEntry): RemoteFsEntry {
  const size = resolveMediaSize(entry);
  const lastModified = getRemoteEntryUpdatedAt(entry);
  const displayName = getRemoteEntryDisplayName(entry);

  const isBloggerDogContentItem = entry.type === 'file';

  // For BloggerDog Content Items, we treat them as directories so they can be entered to see media files
  const entryKind = isBloggerDogContentItem ? 'directory' : entry.type;

  const result: RemoteFsEntry = {
    name: displayName,
    kind: entryKind,
    path: entry.path,
    lastModified,
    source: 'remote',
    remoteId: entry.id,
    remotePath: entry.path,
    remoteType: entry.type,
    remoteData: entry,
    size,
    created: lastModified,
    mimeType: entry.type === 'directory' ? 'folder' : resolveMediaMimeType(entry.media),
    ...(isBloggerDogContentItem ? { isContentItem: true } : {}),
  };

  // For content items, expose the first media's thumbnail if available
  if (isBloggerDogContentItem && entry.media?.length) {
    const firstMediaWithThumbnail = entry.media.find((m) => m.thumbnailUrl) || entry.media[0];
    if (firstMediaWithThumbnail?.thumbnailUrl) {
      (result as any).remoteThumbnailUrl = firstMediaWithThumbnail.thumbnailUrl;
    }
    // Also mark if it's primarily text
    if (!entry.media.length && (entry as any).text?.trim()) {
      (result as any).isTextContent = true;
    }
  } else if (isBloggerDogContentItem && (entry as any).text?.trim()) {
    (result as any).isTextContent = true;
  }

  return result;
}

export function createRemoteMediaFsEntry(params: {
  item: RemoteVfsFileEntry;
  media: RemoteVfsMedia;
  mediaIndex?: number;
}): RemoteFsEntry {
  const mediaName = getRemoteMediaDisplayName({
    entry: params.item,
    media: params.media,
    mediaIndex: params.mediaIndex,
  });
  const remotePath = `${params.item.path}#media-${params.media.id || params.mediaIndex || 0}`;

  return {
    name: mediaName,
    kind: 'file',
    path: remotePath,
    source: 'remote',
    remoteId: `${params.item.id}:${params.media.id}`,
    remotePath,
    remoteType: 'file',
    remoteData: {
      ...params.item,
      name: mediaName,
      title: mediaName,
      path: remotePath,
      media: [params.media],
    },
    size: params.media.size ?? 0,
    mimeType: params.media.mimeType ?? 'application/octet-stream',
  };
}

export function isRemoteFsEntry(entry: FsEntry | null | undefined): entry is RemoteFsEntry {
  return Boolean(entry && (entry as RemoteFsEntry).source === 'remote');
}

export function getRemoteFileDownloadUrl(params: {
  baseUrl: string;
  entry: RemoteVfsFileEntry;
  mediaIndex?: number;
}): string {
  const media = params.entry.media?.[params.mediaIndex ?? 0];
  if (!media?.url) return '';
  if (/^https?:\/\//i.test(media.url)) return media.url;

  try {
    const rootBaseUrl = new URL(params.baseUrl).origin;
    return joinPath(rootBaseUrl, media.url);
  } catch {
    return media.url;
  }
}

export function getRemoteThumbnailUrl(params: { baseUrl: string; media: RemoteVfsMedia }): string {
  if (!params.media.thumbnailUrl) return '';
  if (/^https?:\/\//i.test(params.media.thumbnailUrl)) return params.media.thumbnailUrl;

  try {
    const rootBaseUrl = new URL(params.baseUrl).origin;
    return joinPath(rootBaseUrl, params.media.thumbnailUrl);
  } catch {
    return params.media.thumbnailUrl;
  }
}

export async function fetchRemoteVfsList(params: {
  config: RemoteVfsClientConfig;
  path: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  tags?: string[];
  language?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<RemoteVfsListResponse> {
  const url = new URL(joinPath(params.config.baseUrl, 'list'));
  url.searchParams.set('path', params.path || '/');

  if (params.sortBy) {
    const apiSortBy = params.sortBy === 'name' ? 'title' : 'createdAt';
    url.searchParams.set('sortBy', apiSortBy);
  }

  if (params.sortOrder) {
    url.searchParams.set('sortOrder', params.sortOrder);
  }

  if (params.search) {
    url.searchParams.set('search', params.search);
  }

  if (params.tags?.length) {
    url.searchParams.set('tags', params.tags.join(','));
  }

  if (params.language) {
    url.searchParams.set('language', params.language);
  }

  if (params.limit !== undefined) {
    url.searchParams.set('limit', params.limit.toString());
  }

  if (params.offset !== undefined) {
    url.searchParams.set('offset', params.offset.toString());
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to load remote directory (${response.status})`);
  }

  return (await response.json()) as RemoteVfsListResponse;
}

export async function fetchRemoteHealth(params: {
  url: string;
  bearerToken: string;
  signal?: AbortSignal;
}): Promise<RemoteVfsHealthResponse> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
    },
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Remote health failed (${response.status})`);
  }

  return (await response.json()) as RemoteVfsHealthResponse;
}

export async function downloadRemoteFile(params: {
  url: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', params.url);
    xhr.responseType = 'blob';

    xhr.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress?.(Math.min(1, event.loaded / event.total));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(1);
        resolve(xhr.response as Blob);
        return;
      }
      reject(new Error(xhr.responseText || `Failed to download file (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error('Failed to download file'));
    xhr.onabort = () => {
      const error = new Error('Download aborted');
      (error as Error & { name: string }).name = 'AbortError';
      reject(error);
    };

    if (params.signal) {
      params.signal.addEventListener(
        'abort',
        () => {
          if (xhr.readyState !== XMLHttpRequest.DONE) {
            xhr.abort();
          }
        },
        { once: true },
      );
    }

    xhr.send();
  });
}

export async function uploadFileToRemote(params: {
  config: RemoteVfsClientConfig;
  file: File;
  path?: string;
  projectId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const url = joinPath(params.config.baseUrl, 'upload');
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${params.config.bearerToken}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress?.(Math.min(1, event.loaded / event.total));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(1);
        resolve();
        return;
      }
      reject(new Error(xhr.responseText || `Failed to upload file (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error('Failed to upload file'));
    xhr.onabort = () => {
      const error = new Error('Upload aborted');
      (error as Error & { name: string }).name = 'AbortError';
      reject(error);
    };

    if (params.signal) {
      params.signal.addEventListener(
        'abort',
        () => {
          if (xhr.readyState !== XMLHttpRequest.DONE) {
            xhr.abort();
          }
        },
        { once: true },
      );
    }

    const formData = new FormData();
    formData.append('file', params.file);
    if (params.path) {
      formData.append('path', params.path);
    }
    if (params.projectId) {
      formData.append('projectId', params.projectId);
    }
    xhr.send(formData);
  });
}

export async function createRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  name: string;
  parentId?: string;
  path?: string;
  projectId?: string;
}): Promise<RemoteVfsDirectoryEntry> {
  const response = await fetch(joinPath(params.config.baseUrl, 'collections'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
    body: JSON.stringify({
      name: params.name,
      parentId: params.parentId,
      path: params.path,
      projectId: params.projectId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to create collection (${response.status})`);
  }

  return (await response.json()) as RemoteVfsDirectoryEntry;
}

export async function renameRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name: string;
}): Promise<void> {
  const response = await fetch(joinPath(params.config.baseUrl, `collections/${params.id}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
    body: JSON.stringify({ name: params.name }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to rename collection (${response.status})`);
  }
}

export async function deleteRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  id: string;
}): Promise<void> {
  const response = await fetch(joinPath(params.config.baseUrl, `collections/${params.id}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to delete collection (${response.status})`);
  }
}

export async function renameRemoteItem(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name?: string;
  tags?: string[];
  note?: string;
}): Promise<void> {
  const response = await fetch(joinPath(params.config.baseUrl, `items/${params.id}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
    body: JSON.stringify({
      name: params.name,
      tags: params.tags,
      note: params.note,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to update item (${response.status})`);
  }
}

export async function renameRemoteMedia(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name: string;
}): Promise<void> {
  const response = await fetch(joinPath(params.config.baseUrl, `media/${params.id}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
    body: JSON.stringify({ filename: params.name }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to rename media (${response.status})`);
  }
}

export async function deleteRemoteItem(params: {
  config: RemoteVfsClientConfig;
  id: string;
}): Promise<void> {
  const response = await fetch(joinPath(params.config.baseUrl, `items/${params.id}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${params.config.bearerToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to delete item (${response.status})`);
  }
}

export async function searchRemoteVfs(params: {
  config: RemoteVfsClientConfig;
  query: string;
  path?: string;
  signal?: AbortSignal;
}): Promise<RemoteVfsListResponse> {
  return await fetchRemoteVfsList({
    config: params.config,
    path: params.path || '/virtual-all',
    search: params.query,
    signal: params.signal,
  });
}
