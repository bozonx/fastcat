import type { FsEntry } from '~/types/fs';
import type {
  RemoteVfsDirectoryEntry,
  RemoteVfsEntry,
  RemoteVfsFileEntry,
  RemoteVfsHealthResponse,
  RemoteVfsListResponse,
  RemoteVfsMedia,
  RemoteVfsMediaRelation,
  RemoteVfsProjectEntry,
  RemoteVfsScope,
} from '~/types/remote-vfs';
import type { BloggerDogEntryPayload } from '~/types/bloggerdog';

export interface RemoteFsEntry extends FsEntry {
  source: 'remote';
  remoteId: string;
  remotePath: string;
  remoteType: 'file' | 'directory';
  adapterPayload: BloggerDogEntryPayload;
  size?: number;
  mimeType?: string;
  created?: number;
  objectUrl?: string;
  isContentItem?: boolean;
}

export interface RemoteVfsClientConfig {
  baseUrl: string;
  bearerToken: string;
}

export interface RemoteVfsProgressCallbacks {
  onProgress?: (progress: number) => void;
}

export interface FetchRemoteItemsParams {
  config: RemoteVfsClientConfig;
  scope: RemoteVfsScope;
  projectId?: string;
  groupId?: string;
  orphansOnly?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
  tags?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export interface FetchRemoteCollectionsParams {
  config: RemoteVfsClientConfig;
  scope: RemoteVfsScope;
  projectId?: string;
  parentId?: string;
  orphansOnly?: boolean;
  includeChildrenCount?: boolean;
  signal?: AbortSignal;
}

function getProjectsBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/content-library$/, '');
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

function withPath<T extends RemoteVfsEntry>(entry: T, path: string): T {
  return {
    ...entry,
    path,
  };
}

function mapCollectionResponse(entry: RemoteVfsDirectoryEntry): RemoteVfsDirectoryEntry {
  return {
    ...entry,
    name: entry.name || entry.title || 'Untitled',
    created: entry.created || entry.createdAt,
    updated: entry.updated || entry.updatedAt,
    itemsCount: entry.itemsCount ?? entry.directItemsCount,
    type: 'directory' as const,
  };
}

function mapItemResponse(entry: RemoteVfsFileEntry): RemoteVfsFileEntry {
  return {
    ...entry,
    name: entry.name || entry.title || 'Untitled',
    created: entry.created || entry.createdAt,
    updated: entry.updated || entry.updatedAt,
    type: 'file' as const,
  };
}

export function getRemoteEntryDisplayName(entry: { name?: string; title?: string }): string {
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  return title || name || 'Untitled';
}

export function resolveMediaObject(
  media: RemoteVfsMedia | RemoteVfsMediaRelation | undefined,
): RemoteVfsMedia | undefined {
  if (!media) return undefined;
  return 'media' in media ? media.media : media;
}

export function getRemoteMediaId(
  media: RemoteVfsMedia | RemoteVfsMediaRelation | undefined,
): string | undefined {
  return resolveMediaObject(media)?.id;
}

export function getRemoteMediaDisplayName(params: {
  entry: Pick<RemoteVfsFileEntry, 'name' | 'title'>;
  media: RemoteVfsMedia | RemoteVfsMediaRelation;
  mediaIndex?: number;
}): string {
  const mediaObj = resolveMediaObject(params.media);
  if (!mediaObj) return 'Untitled Media';

  const mediaFilename = typeof mediaObj.filename === 'string' ? mediaObj.filename.trim() : '';
  const mediaTitle = typeof mediaObj.title === 'string' ? mediaObj.title.trim() : '';
  const mediaName = typeof mediaObj.name === 'string' ? mediaObj.name.trim() : '';

  if (mediaFilename) return normalizeFileName(mediaFilename);
  if (mediaTitle) return normalizeFileName(mediaTitle);
  if (mediaName) return normalizeFileName(mediaName);

  const itemName = getRemoteEntryDisplayName(params.entry);
  const extensionFromMime = mediaObj.mimeType?.split('/').pop()?.toLowerCase() ?? '';
  const extension =
    extensionFromMime && extensionFromMime !== 'plain' ? `.${extensionFromMime}` : '';
  return normalizeFileName(`${itemName}-${(params.mediaIndex ?? 0) + 1}${extension}`);
}

export function getRemoteMediaKind(
  media: RemoteVfsMedia | RemoteVfsMediaRelation,
): 'video' | 'audio' | 'image' | 'text' | 'document' | 'unknown' {
  const mediaObj = resolveMediaObject(media);
  if (!mediaObj) return 'unknown';

  const mimeType = mediaObj.mimeType?.toLowerCase() ?? '';
  const mediaType = mediaObj.type?.toLowerCase() ?? '';

  if (mimeType.startsWith('video/') || mediaType.includes('video')) return 'video';
  if (mimeType.startsWith('audio/') || mediaType.includes('audio')) return 'audio';
  if (mimeType.startsWith('image/') || mediaType.includes('image')) return 'image';
  if (mimeType.startsWith('text/') || mediaType.includes('text')) return 'text';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mediaType.includes('document')) {
    return 'document';
  }

  return 'unknown';
}

function resolveMediaMimeType(
  media: (RemoteVfsMedia | RemoteVfsMediaRelation)[] | undefined,
): string {
  const first = resolveMediaObject(media?.[0]);
  return first?.mimeType || 'application/octet-stream';
}

function resolveMediaSize(entry: RemoteVfsEntry): number | undefined {
  if (entry.type !== 'file') return undefined;
  const first = resolveMediaObject(entry.media?.[0]);
  return first?.sizeBytes ?? first?.size;
}

function parseRemoteDate(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const value = Date.parse(raw);
    return Number.isNaN(value) ? undefined : value;
  }
  return undefined;
}

function getRemoteEntryUpdatedAt(entry: RemoteVfsEntry): number | undefined {
  if (entry.type === 'project') {
    return parseRemoteDate(entry.updatedAt) ?? parseRemoteDate(entry.createdAt);
  }

  return (
    parseRemoteDate(entry.updated) ??
    parseRemoteDate(entry.updatedAt) ??
    parseRemoteDate((entry.meta as any)?.updatedAt ?? (entry.meta as any)?.date) ??
    getRemoteEntryCreatedAt(entry)
  );
}

function getRemoteEntryCreatedAt(entry: RemoteVfsEntry): number | undefined {
  if (entry.type === 'project') {
    return parseRemoteDate(entry.createdAt);
  }

  return (
    parseRemoteDate(entry.created) ??
    parseRemoteDate(entry.createdAt) ??
    parseRemoteDate((entry.meta as any)?.createdAt)
  );
}

export function toRemoteFsEntry(entry: RemoteVfsEntry): RemoteFsEntry {
  const size = resolveMediaSize(entry);
  const lastModified = getRemoteEntryUpdatedAt(entry);
  const createdAt = getRemoteEntryCreatedAt(entry);
  const displayName = getRemoteEntryDisplayName(entry);
  const path = entry.path ?? `/${entry.id}`;

  const isProject = entry.type === 'project';
  const isContentItem = entry.type === 'file';
  const entryKind = isProject || isContentItem || entry.type === 'directory' ? 'directory' : 'file';

  let thumbnailUrl: string | undefined;
  if (isContentItem && entry.media?.length) {
    const mediaObj = entry.media.map(resolveMediaObject).find((m) => m?.thumbnailUrl);
    thumbnailUrl = mediaObj?.thumbnailUrl || resolveMediaObject(entry.media[0])?.thumbnailUrl;
  }

  const payloadType = isProject ? 'project' : isContentItem ? 'content-item' : 'collection';
  const payload: BloggerDogEntryPayload = {
    type: payloadType,
    remoteData: entry,
    thumbnailUrl,
  };

  return {
    name: displayName,
    kind: entryKind,
    path,
    lastModified,
    createdAt,
    source: 'remote',
    remoteId: entry.id,
    remotePath: path,
    remoteType: 'directory',
    adapterPayload: payload,
    size,
    created: createdAt,
    mimeType:
      isProject || entry.type === 'directory' ? 'folder' : resolveMediaMimeType(entry.media),
    isContentItem,
  };
}

export function createRemoteMediaFsEntry(params: {
  item: RemoteVfsFileEntry;
  media: RemoteVfsMedia | RemoteVfsMediaRelation;
  mediaIndex?: number;
}): RemoteFsEntry {
  const mediaObj = resolveMediaObject(params.media);
  if (!mediaObj) throw new Error('Invalid media object');

  const mediaName = getRemoteMediaDisplayName({
    entry: params.item,
    media: params.media,
    mediaIndex: params.mediaIndex,
  });
  const remotePath = `${params.item.path ?? `/${params.item.id}`}#media-${mediaObj.id || params.mediaIndex || 0}`;

  const payload: BloggerDogEntryPayload = {
    type: 'media',
    remoteData: withPath(
      {
        ...params.item,
        name: mediaName,
        title: mediaName,
        media: [mediaObj],
      },
      remotePath,
    ),
    mediaId: mediaObj.id,
    thumbnailUrl: mediaObj.thumbnailUrl,
  };

  return {
    name: mediaName,
    kind: 'file',
    path: remotePath,
    source: 'remote',
    remoteId: `${params.item.id}:${mediaObj.id}`,
    remotePath,
    remoteType: 'file',
    adapterPayload: payload,
    size: mediaObj.sizeBytes ?? mediaObj.size ?? 0,
    lastModified:
      parseRemoteDate(mediaObj.updatedAt) ??
      parseRemoteDate(mediaObj.updated) ??
      parseRemoteDate(params.item.updatedAt),
    createdAt:
      parseRemoteDate(mediaObj.createdAt) ??
      parseRemoteDate(mediaObj.created) ??
      parseRemoteDate(params.item.createdAt),
    mimeType: mediaObj.mimeType ?? 'application/octet-stream',
  };
}

export function isRemoteFsEntry(entry: FsEntry | null | undefined): entry is RemoteFsEntry {
  return Boolean(entry && (entry as RemoteFsEntry).source === 'remote');
}

export function getRemoteFileDownloadUrl(params: {
  baseUrl: string;
  entry?: RemoteVfsFileEntry;
  media?: RemoteVfsMedia | RemoteVfsMediaRelation;
  mediaId?: string;
  mediaIndex?: number;
}): string {
  const mediaObj = resolveMediaObject(
    params.media ?? params.entry?.media?.[params.mediaIndex ?? 0],
  );
  if (mediaObj?.url) {
    if (/^https?:\/\//i.test(mediaObj.url)) return mediaObj.url;

    try {
      const rootBaseUrl = new URL(params.baseUrl).origin;
      return joinPath(rootBaseUrl, mediaObj.url);
    } catch {
      return mediaObj.url;
    }
  }

  const mediaId = params.mediaId ?? mediaObj?.id;
  if (!mediaId) return '';
  return joinPath(params.baseUrl, `media/${mediaId}/file?download=1`);
}

export function getRemoteThumbnailUrl(params: {
  baseUrl: string;
  media?: RemoteVfsMedia | RemoteVfsMediaRelation;
  mediaId?: string;
  width?: number;
  height?: number;
}): string {
  const mediaObj = resolveMediaObject(params.media);
  if (mediaObj?.thumbnailUrl) {
    if (/^https?:\/\//i.test(mediaObj.thumbnailUrl)) return mediaObj.thumbnailUrl;

    try {
      const rootBaseUrl = new URL(params.baseUrl).origin;
      return joinPath(rootBaseUrl, mediaObj.thumbnailUrl);
    } catch {
      return mediaObj.thumbnailUrl;
    }
  }

  const mediaId = params.mediaId ?? mediaObj?.id;
  if (!mediaId) return '';

  const width = params.width ?? 400;
  const height = params.height ?? 400;
  return joinPath(params.baseUrl, `media/${mediaId}/thumbnail?w=${width}&h=${height}`);
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function createAuthorizedHeaders(
  config: RemoteVfsClientConfig,
  extra: Record<string, string> = {},
): HeadersInit {
  return {
    Authorization: `Bearer ${config.bearerToken}`,
    ...extra,
  };
}

export async function fetchRemoteProjects(params: {
  config: RemoteVfsClientConfig;
  signal?: AbortSignal;
}): Promise<RemoteVfsProjectEntry[]> {
  const response = await fetchJson<Omit<RemoteVfsProjectEntry, 'type'>[]>(
    joinPath(getProjectsBaseUrl(params.config.baseUrl), 'projects'),
    {
      method: 'GET',
      headers: createAuthorizedHeaders(params.config),
      signal: params.signal,
    },
  );

  return response.map((project) => ({
    ...project,
    type: 'project',
  }));
}

export async function fetchRemoteCollections(
  params: FetchRemoteCollectionsParams,
): Promise<RemoteVfsDirectoryEntry[]> {
  const url = new URL(joinPath(params.config.baseUrl, 'collections'));
  url.searchParams.set('scope', params.scope);
  if (params.projectId) {
    url.searchParams.set('projectId', params.projectId);
  }
  if (params.parentId) {
    url.searchParams.set('parentId', params.parentId);
  }
  if (params.orphansOnly !== undefined) {
    url.searchParams.set('orphansOnly', params.orphansOnly ? 'true' : 'false');
  }
  if (params.includeChildrenCount) {
    url.searchParams.set('includeChildrenCount', 'true');
  }

  const response = await fetchJson<RemoteVfsDirectoryEntry[]>(url, {
    method: 'GET',
    headers: createAuthorizedHeaders(params.config),
    signal: params.signal,
  });

  return response.map((entry) =>
    mapCollectionResponse({
      ...entry,
      scope: params.scope,
      projectId: params.projectId,
    }),
  );
}

export async function fetchRemoteItems(
  params: FetchRemoteItemsParams,
): Promise<RemoteVfsListResponse> {
  const url = new URL(joinPath(params.config.baseUrl, 'items'));
  url.searchParams.set('scope', params.scope);
  if (params.projectId) {
    url.searchParams.set('projectId', params.projectId);
  }
  if (params.groupId) {
    url.searchParams.set('groupId', params.groupId);
  }
  if (params.orphansOnly !== undefined) {
    url.searchParams.set('orphansOnly', params.orphansOnly ? 'true' : 'false');
  }
  if (params.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.offset !== undefined) {
    url.searchParams.set('offset', String(params.offset));
  }
  if (params.search) {
    url.searchParams.set('search', params.search);
  }
  if (params.tags?.length) {
    url.searchParams.set('tags', params.tags.join(','));
  }
  if (params.sortBy) {
    url.searchParams.set('sortBy', params.sortBy === 'name' ? 'title' : params.sortBy);
  }
  if (params.sortOrder) {
    url.searchParams.set('sortOrder', params.sortOrder);
  }

  const response = await fetchJson<{ items: RemoteVfsFileEntry[]; total: number }>(url, {
    method: 'GET',
    headers: createAuthorizedHeaders(params.config),
    signal: params.signal,
  });

  return {
    type: 'directory',
    items: response.items.map((entry) =>
      mapItemResponse({
        ...entry,
        scope: params.scope,
        projectId: params.projectId,
      }),
    ),
    total: response.total,
  };
}

export async function fetchRemoteHealth(params: {
  url: string;
  bearerToken: string;
  signal?: AbortSignal;
}): Promise<RemoteVfsHealthResponse> {
  return await fetchJson<RemoteVfsHealthResponse>(params.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.bearerToken}`,
    },
    signal: params.signal,
  });
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
  scope: RemoteVfsScope;
  projectId?: string;
  groupId?: string;
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
    formData.append('scope', params.scope);
    if (params.projectId) {
      formData.append('projectId', params.projectId);
    }
    if (params.groupId) {
      formData.append('groupId', params.groupId);
    }
    xhr.send(formData);
  });
}

export async function createRemoteItem(params: {
  config: RemoteVfsClientConfig;
  title?: string;
  text?: string;
  scope?: RemoteVfsScope;
  projectId?: string;
  groupId?: string;
  tags?: string[];
  note?: string;
}): Promise<RemoteVfsFileEntry> {
  const response = await fetchJson<RemoteVfsFileEntry>(joinPath(params.config.baseUrl, 'items'), {
    method: 'POST',
    headers: createAuthorizedHeaders(params.config, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      title: params.title,
      text: params.text,
      scope: params.scope || 'personal',
      projectId: params.projectId || undefined,
      groupId: params.groupId || undefined,
      tags: params.tags,
      note: params.note,
    }),
  });

  return mapItemResponse({
    ...response,
    scope: params.scope || 'personal',
    projectId: params.projectId,
  });
}

export async function createRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  name: string;
  scope: RemoteVfsScope;
  projectId?: string;
  parentId?: string;
}): Promise<RemoteVfsDirectoryEntry> {
  const response = await fetchJson<RemoteVfsDirectoryEntry>(
    joinPath(params.config.baseUrl, 'collections'),
    {
      method: 'POST',
      headers: createAuthorizedHeaders(params.config, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        title: params.name,
        scope: params.scope,
        projectId: params.projectId,
        parentId: params.parentId,
      }),
    },
  );

  return mapCollectionResponse({
    ...response,
    scope: params.scope,
    projectId: params.projectId,
  });
}

export async function updateRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  id: string;
  title?: string;
  parentId?: string | null;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `collections/${params.id}`), {
    method: 'PATCH',
    headers: createAuthorizedHeaders(params.config, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      title: params.title,
      parentId: params.parentId,
    }),
  });
}

export async function renameRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name: string;
}): Promise<void> {
  await updateRemoteCollection({
    config: params.config,
    id: params.id,
    title: params.name,
  });
}

export async function deleteRemoteCollection(params: {
  config: RemoteVfsClientConfig;
  id: string;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `collections/${params.id}`), {
    method: 'DELETE',
    headers: createAuthorizedHeaders(params.config),
  });
}

export async function updateRemoteItem(params: {
  config: RemoteVfsClientConfig;
  id: string;
  title?: string;
  text?: string;
  groupId?: string | null;
  tags?: string[];
  note?: string;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `items/${params.id}`), {
    method: 'PATCH',
    headers: createAuthorizedHeaders(params.config, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      title: params.title,
      text: params.text,
      groupId: params.groupId,
      tags: params.tags,
      note: params.note,
    }),
  });
}

export async function renameRemoteItem(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name?: string;
  tags?: string[];
  note?: string;
}): Promise<void> {
  await updateRemoteItem({
    config: params.config,
    id: params.id,
    title: params.name,
    tags: params.tags,
    note: params.note,
  });
}

export async function renameRemoteMedia(params: {
  config: RemoteVfsClientConfig;
  id: string;
  name: string;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `media/${params.id}`), {
    method: 'PATCH',
    headers: createAuthorizedHeaders(params.config, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ filename: params.name }),
  });
}

export async function deleteRemoteItem(params: {
  config: RemoteVfsClientConfig;
  id: string;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `items/${params.id}`), {
    method: 'DELETE',
    headers: createAuthorizedHeaders(params.config),
  });
}

export async function deleteRemoteMedia(params: {
  config: RemoteVfsClientConfig;
  id: string;
}): Promise<void> {
  await fetchJson<void>(joinPath(params.config.baseUrl, `media/${params.id}`), {
    method: 'DELETE',
    headers: createAuthorizedHeaders(params.config),
  });
}

export async function searchRemoteVfs(params: {
  config: RemoteVfsClientConfig;
  query: string;
  signal?: AbortSignal;
}): Promise<RemoteVfsListResponse> {
  return await fetchRemoteItems({
    config: params.config,
    scope: 'personal',
    search: params.query,
    signal: params.signal,
  });
}
