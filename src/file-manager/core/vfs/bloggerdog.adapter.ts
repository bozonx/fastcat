import type { IFileSystemAdapter, VfsEntry } from './types';
import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';
import {
  fetchRemoteVfsList,
  getRemoteEntryDisplayName,
  createRemoteCollection,
  deleteRemoteCollection,
  deleteRemoteItem,
  uploadFileToRemote,
  getRemoteFileDownloadUrl,
  getRemoteMediaDisplayName,
  type RemoteVfsClientConfig,
} from '~/utils/remote-vfs';
import type { RemoteVfsFileEntry, RemoteVfsEntry } from '~/types/remote-vfs';
import type { BloggerDogEntryPayload } from '~/types/bloggerdog';

export class BloggerDogVfsAdapter implements IFileSystemAdapter {
  id = 'bloggerdog';

  private idCache = new Map<
    string,
    { id: string; type: 'file' | 'directory' | 'media'; item?: any; mediaIndex?: number }
  >();

  constructor(
    private getConfig: () => RemoteVfsClientConfig | null,
    private t?: (key: string, def?: string) => string,
  ) {}

  async init(): Promise<void> {
    // Lazy init
  }

  private resolveConfig(): RemoteVfsClientConfig {
    const config = this.getConfig();
    if (!config) {
      throw new Error('BloggerDog integration is not configured');
    }
    return config;
  }

  private normalizePath(path: string): string {
    let p = path || '/';
    if (p.startsWith('/remote')) {
      p = p.slice('/remote'.length) || '/';
    }
    if (p === '/' || p === '') return '/';
    p = p.replace(/\/+/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1);
    return p;
  }

  private async ensureParentCache(path: string) {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
      if (!this.idCache.has('/')) {
        await this.readDirectory('/');
      }
      return;
    }
    const parentPath = '/' + parts.slice(0, -1).join('/');
    if (!this.idCache.has(parentPath)) {
      try {
        await this.ensureParentCache(parentPath);
      } catch {
        // Parent doesn't exist anymore, maybe due to rename
        return;
      }
    }
    try {
      await this.readDirectory(parentPath);
    } catch {
      // Parent content gone
    }
  }

  private clearCache(path: string) {
    const normalizedPath = this.normalizePath(path);
    const keysToDelete: string[] = [];
    const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/';

    for (const key of this.idCache.keys()) {
      if (key === normalizedPath || key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.idCache.delete(key);
    }
  }

  private async getIdForPath(path: string): Promise<{
    id: string;
    type: 'file' | 'directory' | 'media';
    item?: any;
    mediaIndex?: number;
  }> {
    const p = this.normalizePath(path);
    if (p === '/' || p === '') return { id: '/', type: 'directory' };
    if (p === '/virtual-all') return { id: 'virtual-all', type: 'directory' };
    if (p === '/personal') return { id: 'personal', type: 'directory' };
    if (p === '/projects') return { id: 'projects', type: 'directory' };

    if (!this.idCache.has(p)) {
      await this.ensureParentCache(p);
    }

    const cached = this.idCache.get(p);
    if (!cached) {
      throw new Error(`Path not found or not cached: ${p} (original: ${path})`);
    }
    return cached;
  }

  async readDirectory(
    path: string,
    options?: { sortBy?: string; sortOrder?: 'asc' | 'desc'; limit?: number; offset?: number },
  ): Promise<VfsEntry[]> {
    const normalizedPath = this.normalizePath(path);
    const config = this.resolveConfig();

    if (normalizedPath === '/' || normalizedPath === '') {
      const virtualPayload = (id: string, name: string): VfsEntry => ({
        name,
        kind: 'directory',
        path: id === 'virtual-all' ? '/virtual-all' : id === 'personal' ? '/personal' : '/projects',
        parentPath: '/',
        adapterPayload: {
          type: 'virtual-folder',
          remoteData: { id, type: 'directory', name, path: '' } as any,
        } as BloggerDogEntryPayload,
      });
      return [
        virtualPayload(
          'virtual-all',
          this.t ? this.t('fastcat.bloggerDog.allContent', 'All Content') : 'All Content',
        ),
        virtualPayload(
          'personal',
          this.t
            ? this.t('fastcat.bloggerDog.personalLibrary', 'Personal Library')
            : 'Personal Library',
        ),
        virtualPayload(
          'projects',
          this.t
            ? this.t('fastcat.bloggerDog.projectLibraries', 'Project Libraries')
            : 'Project Libraries',
        ),
      ];
    }

    // Ensure path is in cache and we know its type
    const cached = await this.getIdForPath(normalizedPath);

    if (cached && cached.type === 'file' && cached.item) {
      const entries: VfsEntry[] = [];
      const item = cached.item as RemoteVfsFileEntry;

      // Add media files
      if (item.media && Array.isArray(item.media)) {
        item.media.forEach((media: any, index: number) => {
          const name = getRemoteMediaDisplayName({ entry: item, media, mediaIndex: index });
          const mediaPath = `${path}/${name}`;
          this.idCache.set(mediaPath, {
            id: media.id || item.id,
            type: 'media',
            item,
            mediaIndex: index,
          });

          const mediaPayload: BloggerDogEntryPayload = {
            type: 'media',
            remoteData: item,
            mediaId: media.id,
            thumbnailUrl: media.thumbnailUrl,
          };

          entries.push({
            name,
            kind: 'file',
            path: mediaPath,
            parentPath: path,
            size: media.size || 0,
            lastModified: item.meta?.updatedAt
              ? new Date(item.meta.updatedAt as string).getTime()
              : undefined,
            adapterPayload: mediaPayload,
          });
        });
      }

      // Simulate text content as a text file
      if (item.text?.trim()) {
        const textName = `${item.title || item.name || 'document'}.txt`;
        const textPath = `${path}/${textName}`;
        this.idCache.set(textPath, { id: item.id, type: 'media', item, mediaIndex: -1 });

        const blob = new Blob([item.text], { type: 'text/plain' });
        const textPayload: BloggerDogEntryPayload = {
          type: 'media',
          remoteData: item,
        };
        entries.push({
          name: textName,
          kind: 'file',
          path: textPath,
          parentPath: path,
          size: blob.size,
          lastModified: item.meta?.updatedAt
            ? new Date(item.meta.updatedAt as string).getTime()
            : undefined,
          adapterPayload: textPayload,
        });
      }

      return entries;
    }

    const remotePath =
      cached.item?.path || (cached.id.startsWith('/') ? cached.id : `/${cached.id}`);
    const response = await fetchRemoteVfsList({
      config,
      path: remotePath,
      sortBy: options?.sortBy,
      sortOrder: options?.sortOrder,
      limit: options?.limit,
      offset: options?.offset,
    });

    // Update cache
    this.idCache.set(path, {
      id: path === '/' ? 'root' : this.idCache.get(path)?.id || '',
      type: 'directory',
    });

    const entries: VfsEntry[] = [];
    for (const item of response.items) {
      const name = getRemoteEntryDisplayName(item);
      const isInsideProjects = normalizedPath === '/projects';
      const entryPath =
        normalizedPath === '/'
          ? `/${name}`
          : isInsideProjects
            ? `${normalizedPath}/${item.id}`
            : `${normalizedPath}/${name}`;
      this.idCache.set(entryPath, { id: item.id, type: item.type, item });

      const isSimpleFile = item.type === 'file' && item.media?.length === 1 && !item.text?.trim();

      const isBloggerDogContentItem = item.type === 'file';
      const firstMediaWithThumbnail = isBloggerDogContentItem
        ? (item as RemoteVfsFileEntry).media?.find((m) => m.thumbnailUrl) ||
          (item as RemoteVfsFileEntry).media?.[0]
        : null;

      const adapterPayload: BloggerDogEntryPayload = {
        type: isInsideProjects ? 'project' : item.type === 'file' ? 'content-item' : 'collection',
        remoteData: item,
        thumbnailUrl: firstMediaWithThumbnail?.thumbnailUrl,
        mediaId: isSimpleFile ? (item as RemoteVfsFileEntry).media?.[0]?.id : undefined,
      };

      entries.push({
        name,
        kind: isSimpleFile ? 'file' : item.type === 'file' ? 'directory' : item.type,
        path: entryPath,
        parentPath: normalizedPath,
        size: item.type === 'file' ? ((item as RemoteVfsFileEntry).media?.[0]?.size ?? 0) : 0,
        lastModified: (item as any).meta?.updatedAt
          ? new Date((item as any).meta.updatedAt).getTime()
          : undefined,
        adapterPayload,
      } as VfsEntry);
    }

    const result = entries as VfsEntry[] & { total?: number };
    result.total = response.total;
    return result;
  }

  async createDirectory(path: string): Promise<void> {
    const config = this.resolveConfig();
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('Invalid directory name');

    const parentPath = '/' + parts.join('/');
    const parent = await this.getIdForPath(parentPath);
    const normalizedParentPath = this.normalizePath(parentPath);

    let parentId: string | undefined;
    let projectId: string | undefined;

    // We can't create collections directly in these virtual paths
    const forbiddenRoots = ['/', 'root', 'projects', 'virtual-all'];
    if (forbiddenRoots.includes(parent.id)) {
      throw new Error(`Cannot create directory in ${normalizedParentPath}`);
    }

    if (normalizedParentPath === '/personal') {
      // For personal root, parentId must be completely excluded (undefined)
      parentId = undefined;
      projectId = undefined;
    } else if (
      normalizedParentPath.startsWith('/projects/') &&
      normalizedParentPath.split('/').filter(Boolean).length === 2
    ) {
      // It's a project root, e.g., /projects/uuid.
      // To create in project root, parentId must be excluded (undefined), but projectId must be set.
      parentId = undefined;
      projectId = parent.id;
    } else {
      // For sub-collections, use the collection UUID as parentId
      parentId = parent.id;
      projectId = undefined;
    }

    const collection = await createRemoteCollection({
      config,
      name,
      parentId,
      projectId,
    });

    this.idCache.set(path, { id: collection.id, type: 'directory' });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((e) => e.name);
  }

  async readFile(path: string, options?: { signal?: AbortSignal }): Promise<Blob> {
    const config = this.resolveConfig();
    const entry = await this.getIdForPath(path);

    let downloadUrl = '';
    if (entry.type === 'media' && entry.item) {
      if (entry.mediaIndex === -1) {
        const textData = (entry.item as RemoteVfsFileEntry).text || '';
        return new Blob([textData], { type: 'text/plain' });
      }

      downloadUrl = getRemoteFileDownloadUrl({
        baseUrl: config.baseUrl,
        entry: entry.item,
        mediaIndex: entry.mediaIndex,
      });
    } else {
      throw new Error(`Cannot download a collection or item folder directly: ${path}`);
    }

    const res = await fetch(downloadUrl, { signal: options?.signal });
    if (!res.ok) throw new Error(`Failed to download file from remote: ${res.status}`);
    return res.blob();
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const config = this.resolveConfig();
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('Invalid file name');

    const parentPath = normalizedPath === '/' ? '/' : '/' + parts.join('/');
    let uploadPath = '/virtual-all';
    let projectId: string | undefined;

    // Determine if we are in a project path
    const pathParts = normalizedPath.split('/').filter(Boolean);
    if (pathParts[0] === 'projects' && pathParts.length >= 2) {
      projectId = pathParts[1];
    }

    if (parentPath !== '/') {
      const cached = await this.getIdForPath(parentPath);

      if (normalizedPath.startsWith('/projects/') && pathParts.length === 2) {
        // Saving directly in project root (this case might not happen with parts.pop() above, but for safety)
        uploadPath = `/projects/${projectId}`;
      } else if (normalizedPath.startsWith('/personal') && pathParts.length === 2) {
        uploadPath = '/personal';
      } else if (cached.item?.path) {
        uploadPath = cached.item.path;
      } else if (cached.id) {
        if (cached.id === 'personal') {
          uploadPath = '/personal';
        } else {
          // If it's a collection ID, use it as path (with leading slash for remote API)
          uploadPath = cached.id.startsWith('/') ? cached.id : `/${cached.id}`;
        }
      }
    }

    let fileToUpload: File;
    if (data instanceof Blob) {
      fileToUpload = new File([data], name, { type: data.type });
    } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
      fileToUpload = new File([data as any], name, { type: 'application/octet-stream' });
    } else {
      fileToUpload = new File([data as BlobPart], name, { type: 'text/plain' });
    }

    await uploadFileToRemote({
      config,
      path: uploadPath,
      file: fileToUpload,
      projectId,
    });

    // Clear parent and normalized path for refresh
    this.clearCache(parentPath);
    this.idCache.delete(normalizedPath);
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const config = this.resolveConfig();
    const entry = await this.getIdForPath(path);

    if (entry.type === 'directory') {
      await deleteRemoteCollection({ config, id: entry.id });
    } else if (entry.type === 'media') {
      throw new Error(
        'Deleting individual media files from a content item is not supported by BloggerDog API directly. You must delete the entire content item.',
      );
    } else {
      await deleteRemoteItem({ config, id: entry.id });
    }
    this.clearCache(path);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const config = this.resolveConfig();
    const nSource = this.normalizePath(sourcePath);
    const nTarget = this.normalizePath(targetPath);
    const sourceParts = nSource.split('/').filter(Boolean);
    const targetParts = nTarget.split('/').filter(Boolean);

    const sourceParent = '/' + sourceParts.slice(0, -1).join('/');
    const targetParent = '/' + targetParts.slice(0, -1).join('/');

    if (sourceParent !== targetParent) {
      throw new Error(
        'Moving between directories is not fully supported by BloggerDog API directly, only renaming is supported.',
      );
    }

    const newName = targetParts.pop();
    if (!newName) throw new Error('Invalid target name');

    const entry = await this.getIdForPath(nSource);

    const { renameRemoteCollection, renameRemoteItem, renameRemoteMedia } =
      await import('~/utils/remote-vfs');
    if (entry.type === 'directory') {
      await renameRemoteCollection({ config, id: entry.id, name: newName });
    } else if (entry.type === 'media') {
      await renameRemoteMedia({ config, id: entry.id, name: newName });
    } else {
      await renameRemoteItem({ config, id: entry.id, name: newName });
    }

    this.clearCache(nSource);
    this.idCache.delete(sourceParent);
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const blob = await this.readFile(sourcePath, options);
    await this.writeFile(targetPath, blob);
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    await this.copyDirectoryRecursive(sourcePath, targetPath, 0, options);
  }

  private async copyDirectoryRecursive(
    sourcePath: string,
    targetPath: string,
    depth: number,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    if (depth > MAX_COPY_DEPTH) {
      throw new Error(`Maximum copy depth exceeded (${MAX_COPY_DEPTH})`);
    }

    await this.createDirectory(targetPath);
    const entries = await this.readDirectory(sourcePath);
    for (const entry of entries) {
      const nextTargetPath = `${targetPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await this.copyDirectoryRecursive(entry.path, nextTargetPath, depth + 1);
      } else {
        await this.copyFile(entry.path, nextTargetPath);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getIdForPath(path);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    try {
      const entry = await this.getIdForPath(path);
      if (!entry) return null;

      let size = 0;
      let lastModified = Date.now();

      if (entry.type === 'media' && entry.item) {
        if (entry.mediaIndex === undefined || entry.mediaIndex === -1) {
          size = ((entry.item as RemoteVfsFileEntry).text || '').length;
        } else {
          size = (entry.item as RemoteVfsFileEntry).media?.[entry.mediaIndex]?.size || 0;
        }
        lastModified = entry.item.meta?.updatedAt
          ? new Date(entry.item.meta.updatedAt as string).getTime()
          : lastModified;
      } else if (entry.item && entry.type === 'file') {
        size = (entry.item as RemoteVfsFileEntry).media?.[0]?.size || 0;
        lastModified = entry.item.meta?.updatedAt
          ? new Date(entry.item.meta.updatedAt as string).getTime()
          : lastModified;
      }

      return {
        size,
        lastModified,
        kind: entry.type === 'directory' ? 'directory' : 'file',
      };
    } catch {
      return null;
    }
  }

  async getObjectUrl(path: string): Promise<string> {
    const config = this.resolveConfig();
    const entry = await this.getIdForPath(path);

    if (entry.type === 'media' && entry.item) {
      if (entry.mediaIndex === -1) {
        const textData = (entry.item as RemoteVfsFileEntry).text || '';
        const blob = new Blob([textData], { type: 'text/plain' });
        return URL.createObjectURL(blob);
      }
      return getRemoteFileDownloadUrl({
        baseUrl: config.baseUrl,
        entry: entry.item,
        mediaIndex: entry.mediaIndex ?? 0,
      });
    }

    throw new Error(`Path is not a valid media file: ${path}`);
  }

  async getFile(path: string): Promise<File | null> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() || 'download';

    const blob = await this.readFile(path);
    return new File([blob], name, { type: blob.type });
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.readFile(path);
    return blob.stream();
  }

  async writeStream(path: string): Promise<WritableStream<Uint8Array>> {
    throw new Error('writeStream not supported on remote');
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, JSON.stringify(data, null, 2));
  }
}
