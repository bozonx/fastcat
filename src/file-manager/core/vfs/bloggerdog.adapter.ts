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

  constructor(private getConfig: () => RemoteVfsClientConfig | null) {}

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

  private async ensureParentCache(path: string) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 1) {
      if (!this.idCache.has('/')) {
        await this.readDirectory('/');
      }
      return;
    }
    const parentPath = '/' + parts.slice(0, -1).join('/');
    if (!this.idCache.has(parentPath)) {
      await this.ensureParentCache(parentPath);
    }
    await this.readDirectory(parentPath);
  }

  private async getIdForPath(path: string): Promise<{ id: string; type: 'file' | 'directory' | 'media'; item?: any; mediaIndex?: number }> {
    if (path === '/' || path === '') return { id: 'virtual-all', type: 'directory' };
    
    if (!this.idCache.has(path)) {
      await this.ensureParentCache(path);
    }

    const cached = this.idCache.get(path);
    if (!cached) {
      throw new Error(`Path not found or not cached: ${path}`);
    }
    return cached;
  }

  async readDirectory(path: string): Promise<VfsEntry[]> {
    const config = this.resolveConfig();

    // Ensure path is in cache and we know its type
    const cached = await this.getIdForPath(path);
    
    // If it's a file (Content Item), we list its media files or text content as a folder
    if (cached && cached.type === 'file' && cached.item) {
      const entries: VfsEntry[] = [];
      const item = cached.item as RemoteVfsFileEntry;
      
      // Add media files
      if (item.media && Array.isArray(item.media)) {
        item.media.forEach((media: any, index: number) => {
          const name = getRemoteMediaDisplayName({ entry: item, media, mediaIndex: index });
          const mediaPath = `${path}/${name}`;
          this.idCache.set(mediaPath, { id: item.id, type: 'media', item, mediaIndex: index });
          
          entries.push({
            name,
            kind: 'file',
            path: mediaPath,
            parentPath: path,
            size: media.size || 0,
            lastModified: item.meta?.updatedAt ? new Date(item.meta.updatedAt as string).getTime() : undefined,
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
        });
      }

      return entries;
    }

    const response = await fetchRemoteVfsList({ config, path });
    
    // Update cache
    this.idCache.set(path, { id: path === '/' ? 'virtual-all' : this.idCache.get(path)?.id || '', type: 'directory' });

    const entries: VfsEntry[] = [];
    for (const item of response.items) {
      const entryPath = item.path || (path === '/' ? `/${item.name}` : `${path}/${item.name}`);
      this.idCache.set(entryPath, { id: item.id, type: item.type, item });
      
      entries.push({
        name: getRemoteEntryDisplayName(item),
        kind: item.type === 'file' ? 'directory' : item.type,
        path: entryPath,
        parentPath: path,
        size: 0,
        lastModified: (item as any).meta?.updatedAt ? new Date((item as any).meta.updatedAt).getTime() : undefined,
        ...(item.type === 'file' ? { isContentItem: true } : {})
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
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error('Invalid file name');
    
    const parentPath = '/' + parts.join('/');
    let parentId = 'virtual-all';
    if (parentPath !== '/') {
      const parent = await this.getIdForPath(parentPath);
      if (parent.type === 'file' || parent.type === 'media') {
        throw new Error('Cannot upload a file directly inside a Content Item folder.');
      }
      parentId = parent.id;
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
      collectionId: parentId,
      file: fileToUpload
    });
    
    // The uploaded file gets an ID from server, but upload API doesn't return the item in GranPublicador currently (depends on backend).
    // We should clear the parent cache so it reloads.
    this.idCache.delete(parentPath);
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const config = this.resolveConfig();
    const entry = await this.getIdForPath(path);
    
    if (entry.type === 'directory') {
      await deleteRemoteCollection({ config, id: entry.id });
    } else {
      await deleteRemoteItem({ config, id: entry.id });
    }
    this.idCache.delete(path);
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    throw new Error('Move is not fully supported by BloggerDog API directly, use copy+delete or backend patch.');
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
