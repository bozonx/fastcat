import type { FsEntry } from '~/types/fs';
import type {
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

  return {
    name: entry.name,
    kind: entry.type,
    handle: {} as FileSystemFileHandle,
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

  const rootBaseUrl = normalizeBaseUrl(params.baseUrl).replace(/\/api\/v1\/external\/vfs$/i, '');
  return joinPath(rootBaseUrl, media.url);
}

export async function fetchRemoteVfsList(params: {
  config: RemoteVfsClientConfig;
  path: string;
  signal?: AbortSignal;
}): Promise<RemoteVfsListResponse> {
  const url = new URL(joinPath(params.config.baseUrl, 'list'));
  url.searchParams.set('path', params.path || '/');

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
  collectionId: string;
  file: File;
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
    formData.append('collectionId', params.collectionId);
    xhr.send(formData);
  });
}
