import type { IFileSystemAdapter, VfsEntry } from './types';
import {
  fetchRemoteVfsList,
  getRemoteEntryDisplayName,
  createRemoteCollection,
  deleteRemoteCollection,
  deleteRemoteItem,
  uploadFileToRemote,
  getRemoteFileDownloadUrl,
  type RemoteVfsClientConfig,
} from '~/utils/remote-vfs';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';

export class BloggerDogVfsAdapter implements IFileSystemAdapter {
  id = 'bloggerdog';

  private idCache = new Map<string, { id: string; type: 'file' | 'directory' | 'media'; item?: any; mediaIndex?: number }>();

  constructor(
    private getConfig: () => RemoteVfsClientConfig | null,
    private t?: (key: string, def?: string) => string
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


  private async getIdForPath(path: string): Promise<{ id: string; type: 'file' | 'directory' | 'media'; item?: any; mediaIndex?: number }> {
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
    options?: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<VfsEntry[]> {
    const normalizedPath = this.normalizePath(path);
    const config = this.resolveConfig();

    if (normalizedPath === '/' || normalizedPath === '') {
      return [
        {
          name: this.t ? this.t('fastcat.bloggerDog.allContent', 'All Content') : 'All Content',
          kind: 'directory',
          path: '/virtual-all',
          parentPath: '/',
          remoteData: { id: 'virtual-all', type: 'directory' } as any,
        },
        {
          name: this.t ? this.t('fastcat.bloggerDog.personalLibrary', 'Personal Library') : 'Personal Library',
          kind: 'directory',
          path: '/personal',
          parentPath: '/',
          remoteData: { id: 'personal', type: 'directory' } as any,
        },
        {
          name: this.t ? this.t('fastcat.bloggerDog.projectLibraries', 'Project Libraries') : 'Project Libraries',
          kind: 'directory',
          path: '/projects',
          parentPath: '/',
          remoteData: { id: 'projects', type: 'directory' } as any,
        },
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
          this.idCache.set(mediaPath, { id: media.id || item.id, type: 'media', item, mediaIndex: index });
          
          entries.push({
            name,
            kind: 'file',
            path: mediaPath,
            parentPath: path,
            size: media.size || 0,
            lastModified: item.meta?.updatedAt ? new Date(item.meta.updatedAt as string).getTime() : undefined,
            isMediaItem: true,
            mediaId: media.id,
            remoteData: item,
          });
        });
      }
      
      // Simulate text content as a text file
      if (item.text?.trim()) {
        const textName = `${item.title || item.name || 'document'}.txt`;
        const textPath = `${path}/${textName}`;
        this.idCache.set(textPath, { id: item.id, type: 'media', item, mediaIndex: -1 });

        const blob = new Blob([item.text], { type: 'text/plain' });
        entries.push({
          name: textName,
          kind: 'file',
          path: textPath,
          parentPath: path,
          size: blob.size,
          lastModified: item.meta?.updatedAt ? new Date(item.meta.updatedAt as string).getTime() : undefined,
          remoteData: item,
        });
      }

      return entries;
    }

    const remotePath = cached.item?.path || (cached.id.startsWith('/') ? cached.id : `/${cached.id}`);
    const response = await fetchRemoteVfsList({
      config,
      path: remotePath,
      sortBy: options?.sortBy,
      sortOrder: options?.sortOrder,
    });
    
    // Update cache
    this.idCache.set(path, { id: path === '/' ? 'root' : this.idCache.get(path)?.id || '', type: 'directory' });

    const entries: VfsEntry[] = [];
    for (const item of response.items) {
      const name = getRemoteEntryDisplayName(item);
      const isInsideProjects = normalizedPath === '/projects';
      const entryPath = normalizedPath === '/' ? `/${name}` : (isInsideProjects ? `${normalizedPath}/${item.id}` : `${normalizedPath}/${name}`);
      this.idCache.set(entryPath, { id: item.id, type: item.type, item });
      
      const isSimpleFile = item.type === 'file' && item.media?.length === 1 && !item.text?.trim();

      entries.push({
        name,
        kind: isSimpleFile ? 'file' : (item.type === 'file' ? 'directory' : item.type),
        path: entryPath,
        parentPath: normalizedPath,
        size: item.type === 'file' ? ((item as RemoteVfsFileEntry).media?.[0]?.size ?? 0) : 0,
        lastModified: (item as any).meta?.updatedAt ? new Date((item as any).meta.updatedAt).getTime() : undefined,
        isContentItem: item.type === 'file',
        isMediaItem: isSimpleFile,
        mediaId: isSimpleFile ? (item as RemoteVfsFileEntry).media?.[0]?.id : undefined,
        remoteData: item,
      } as VfsEntry);
    }
    
    return entries;
  }

  async createDirectory(path: string): Promise<void> {
    const config = this.resolveConfig();
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('Invalid directory name');
    
    const parentPath = '/' + parts.join('/');
    const parent = await this.getIdForPath(parentPath);
    
    const collection = await createRemoteCollection({
      config,
      name,
      parentId: parent.id === 'virtual-all' ? undefined : parent.id
    });
    
    this.idCache.set(path, { id: collection.id, type: 'directory' });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map(e => e.name);
  }

  async readFile(path: string): Promise<Blob> {
    const config = this.resolveConfig();
    const entry = await this.getIdForPath(path);
    
    let downloadUrl = '';
    if (entry.type === 'media' && entry.item) {
      if (entry.mediaIndex === -1) {
        const textData = (entry.item as RemoteVfsFileEntry).text || '';
        return new Blob([textData], { type: 'text/plain' });
      }

      downloadUrl = getRemoteFileDownloadUrl({ baseUrl: config.baseUrl, entry: entry.item, mediaIndex: entry.mediaIndex });
    } else {
      throw new Error(`Cannot download a collection or item folder directly: ${path}`);
    }
    
    const res = await fetch(downloadUrl);
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

    if (parentPath !== '/') {
      const cached = await this.getIdForPath(parentPath);
      
      // If we are in a project folder, path must be /projects/{id}
      const parentParts = parentPath.split('/').filter(Boolean);
      const isProjectRoot = parentParts[0] === 'projects' && parentParts.length === 2;
      
      if (isProjectRoot) {
        uploadPath = `/projects/${cached.id}`;
        projectId = cached.id;
      } else if (cached.item?.path) {
        uploadPath = cached.item.path;
      } else if (cached.id) {
        // Special case for personal root
        if (cached.id === 'personal') {
          uploadPath = '/personal';
        } else {
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
      projectId
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
      throw new Error('Deleting individual media files from a content item is not supported by BloggerDog API directly. You must delete the entire content item.');
    } else {
      await deleteRemoteItem({ config, id: entry.id });
    }
    this.clearCache(path);
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    const config = this.resolveConfig();
    const nSource = this.normalizePath(sourcePath);
    const nTarget = this.normalizePath(targetPath);
    const sourceParts = nSource.split('/').filter(Boolean);
    const targetParts = nTarget.split('/').filter(Boolean);
    
    const sourceParent = '/' + sourceParts.slice(0, -1).join('/');
    const targetParent = '/' + targetParts.slice(0, -1).join('/');
    
    if (sourceParent !== targetParent) {
      throw new Error('Moving between directories is not fully supported by BloggerDog API directly, only renaming is supported.');
    }
    
    const newName = targetParts.pop();
    if (!newName) throw new Error('Invalid target name');
    
    const entry = await this.getIdForPath(nSource);
    
    const { renameRemoteCollection, renameRemoteItem, renameRemoteMedia } = await import('~/utils/remote-vfs');
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

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const blob = await this.readFile(sourcePath);
    await this.writeFile(targetPath, blob);
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    await this.createDirectory(targetPath);
    const entries = await this.readDirectory(sourcePath);
    for (const entry of entries) {
      const nextTargetPath = `${targetPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await this.copyDirectory(entry.path, nextTargetPath);
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

  async getMetadata(path: string): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    const cache = this.idCache.get(path);
    if (!cache) return null; // Simplified
    return {
      size: 0,
      lastModified: Date.now(),
      kind: cache.type === 'directory' ? 'directory' : 'file'
    };
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
      return getRemoteFileDownloadUrl({ baseUrl: config.baseUrl, entry: entry.item, mediaIndex: entry.mediaIndex });
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
