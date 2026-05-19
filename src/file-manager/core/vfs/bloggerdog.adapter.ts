import type {
  IFileSystemAdapter,
  VfsEntry,
  VfsEntryMetadata,
  VfsOperationOptions,
  VfsReadDirectoryOptions,
} from './types';
import { copyDirectoryTree } from './copyTree';
import { normalizeBloggerDogTextWrapperTitle } from '~/utils/bloggerdog-file-manager';
import {
  VfsConflictError,
  VfsInvalidArgumentError,
  VfsNotFoundError,
  VfsUnsupportedError,
  throwIfAborted,
} from './errors';
import {
  createRemoteCollection,
  createRemoteMediaFsEntry,
  deleteRemoteCollection,
  deleteRemoteItem,
  deleteRemoteMedia,
  fetchRemoteItem,
  fetchRemoteCollections,
  fetchRemoteItems,
  fetchRemoteProjects,
  getRemoteEntryDisplayName,
  getRemoteFileDownloadUrl,
  getRemoteMediaId,
  getRemoteMediaDisplayName,
  renameRemoteMedia,
  resolveMediaObject,
  toRemoteFsEntry,
  updateRemoteCollection,
  updateRemoteItem,
  uploadFileToRemote,
  type RemoteVfsClientConfig,
} from '~/utils/remote-vfs';
import type {
  RemoteVfsDirectoryEntry,
  RemoteVfsFileEntry,
  RemoteVfsMedia,
  RemoteVfsMediaRelation,
  RemoteVfsProjectEntry,
  RemoteVfsScope,
} from '~/types/remote-vfs';
import type { BloggerDogEntryPayload } from '~/types/bloggerdog';

type CachedNodeType = 'file' | 'directory' | 'media' | 'project' | 'virtual-folder';
type RootFolderId = 'virtual-all' | 'personal' | 'projects';

interface CachedNode {
  id: string;
  type: CachedNodeType;
  path: string;
  scope?: RemoteVfsScope;
  projectId?: string;
  parentId?: string | null;
  rootFolderId?: RootFolderId;
  item?: RemoteVfsFileEntry;
  collection?: RemoteVfsDirectoryEntry;
  project?: RemoteVfsProjectEntry;
  media?: RemoteVfsMedia | RemoteVfsMediaRelation;
  mediaIndex?: number;
}

interface DirectoryContext {
  scope: RemoteVfsScope;
  projectId?: string;
  groupId?: string;
}

interface ListedEntry {
  entry: VfsEntry;
  lastModified: number;
  createdAt: number;
}

/** LRU cap. Keeps RAM bounded on long sessions across many folders. */
const MAX_ID_CACHE_SIZE = 2_000;
/** Cap on retained object URLs (thumbnails etc.). */
const MAX_TRACKED_OBJECT_URLS = 256;

export class BloggerDogVfsAdapter implements IFileSystemAdapter {
  id = 'bloggerdog';
  preservesEntryNames = true;

  // Insertion-ordered Map → cheap LRU: re-insert on access, drop oldest on overflow.
  private idCache = new Map<string, CachedNode>();
  private objectUrlsByPath = new Map<string, string>();

  constructor(
    private getConfig: () => RemoteVfsClientConfig | null,
    private t?: (key: string, def?: string) => string,
  ) {}

  async init(): Promise<void> {
    // Lazy init — config and identity are resolved per-call.
  }

  private resolveConfig(): RemoteVfsClientConfig {
    const config = this.getConfig();
    if (!config) {
      throw new VfsUnsupportedError('BloggerDog integration is not configured');
    }
    return config;
  }

  private normalizePath(path: string): string {
    let normalized = path || '/';
    if (normalized.startsWith('/remote')) {
      normalized = normalized.slice('/remote'.length) || '/';
    }
    normalized = normalized.replace(/\/+/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized || '/';
  }

  private setCache(path: string, node: CachedNode): void {
    this.idCache.delete(path);
    this.idCache.set(path, node);
    while (this.idCache.size > MAX_ID_CACHE_SIZE) {
      const oldest = this.idCache.keys().next().value;
      if (oldest === undefined) break;
      this.idCache.delete(oldest);
    }
  }

  private clearCache(path: string) {
    const normalizedPath = this.normalizePath(path);
    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
    for (const key of [...this.idCache.keys()]) {
      if (key === normalizedPath || key.startsWith(prefix)) {
        this.idCache.delete(key);
      }
    }
  }

  private trackObjectUrl(path: string, url: string): void {
    this.objectUrlsByPath.delete(path);
    this.objectUrlsByPath.set(path, url);
    while (this.objectUrlsByPath.size > MAX_TRACKED_OBJECT_URLS) {
      const oldestKey = this.objectUrlsByPath.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestUrl = this.objectUrlsByPath.get(oldestKey)!;
      URL.revokeObjectURL(oldestUrl);
      this.objectUrlsByPath.delete(oldestKey);
    }
  }

  private revokeObjectUrl(path: string): void {
    const url = this.objectUrlsByPath.get(path);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrlsByPath.delete(path);
    }
  }

  /** @internal Test hook. */
  _idCacheSize(): number {
    return this.idCache.size;
  }
  /** @internal Test hook. */
  _trackedObjectUrlCount(): number {
    return this.objectUrlsByPath.size;
  }

  private toDisplayName(name: string | undefined, fallback: string): string {
    const trimmed = name?.trim();
    return trimmed || fallback;
  }

  private createVirtualRootEntry(id: RootFolderId, name: string): VfsEntry {
    const path =
      id === 'virtual-all' ? '/virtual-all' : id === 'personal' ? '/personal' : '/projects';
    const cachedNode: CachedNode = {
      id,
      type: 'virtual-folder',
      path,
      rootFolderId: id,
    };
    this.setCache(path, cachedNode);

    return {
      name,
      kind: 'directory',
      path,
      parentPath: '/',
      adapterPayload: {
        type: 'virtual-folder',
        remoteData: {
          id,
          name,
          path,
          type: 'directory',
        },
      } as BloggerDogEntryPayload,
    };
  }

  private createProjectEntry(project: RemoteVfsProjectEntry): VfsEntry {
    const path = `/projects/${project.id}`;
    const entryWithPath: RemoteVfsProjectEntry = {
      ...project,
      path,
      type: 'project',
    };
    this.setCache(path, {
      id: project.id,
      type: 'project',
      path,
      scope: 'project',
      projectId: project.id,
      project: entryWithPath,
    });

    return {
      ...toRemoteFsEntry(entryWithPath, { baseUrl: this.getConfig()?.baseUrl }),
      path,
      parentPath: '/projects',
    } as VfsEntry;
  }

  private createCollectionEntry(params: {
    collection: RemoteVfsDirectoryEntry;
    path: string;
    parentPath: string;
    scope: RemoteVfsScope;
    projectId?: string;
  }): VfsEntry {
    const collectionWithPath: RemoteVfsDirectoryEntry = {
      ...params.collection,
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
    };
    this.setCache(params.path, {
      id: params.collection.id,
      type: 'directory',
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
      parentId: params.collection.parentId ?? null,
      collection: collectionWithPath,
    });

    return {
      ...toRemoteFsEntry(collectionWithPath, { baseUrl: this.getConfig()?.baseUrl }),
      path: params.path,
      parentPath: params.parentPath,
      hasChildren: true,
      hasDirectories: true,
    } as VfsEntry;
  }

  private createItemEntry(params: {
    item: RemoteVfsFileEntry;
    path: string;
    parentPath: string;
    scope: RemoteVfsScope;
    projectId?: string;
  }): VfsEntry {
    const itemWithPath: RemoteVfsFileEntry = {
      ...params.item,
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
    };
    this.setCache(params.path, {
      id: params.item.id,
      type: 'file',
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
      parentId: params.item.groupId ?? null,
      item: itemWithPath,
    });

    return {
      ...toRemoteFsEntry(itemWithPath, { baseUrl: this.getConfig()?.baseUrl }),
      kind: 'directory',
      path: params.path,
      parentPath: params.parentPath,
      hasChildren: true,
      hasDirectories: false,
    } as VfsEntry;
  }

  private toComparableEntry(entry: VfsEntry): ListedEntry {
    return {
      entry,
      lastModified: entry.lastModified ?? 0,
      createdAt: entry.createdAt ?? 0,
    };
  }

  private sortEntries(
    entries: ListedEntry[],
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): ListedEntry[] {
    const direction = sortOrder === 'desc' ? -1 : 1;
    return [...entries].sort((left, right) => {
      if (left.entry.kind !== right.entry.kind) {
        return left.entry.kind === 'directory' ? -1 : 1;
      }

      if (sortBy === 'created') {
        return (left.createdAt - right.createdAt) * direction;
      }

      const leftName = left.entry.name.toLowerCase();
      const rightName = right.entry.name.toLowerCase();
      return leftName.localeCompare(rightName) * direction;
    });
  }

  private paginateEntries(entries: ListedEntry[], limit?: number, offset?: number): VfsEntry[] {
    const start = Math.max(offset ?? 0, 0);
    const end = limit === undefined ? undefined : start + Math.max(limit, 0);
    return entries.slice(start, end).map((item) => item.entry);
  }

  private async getIdForPath(path: string): Promise<CachedNode> {
    const normalizedPath = this.normalizePath(path);
    if (normalizedPath === '/') {
      return { id: '/', type: 'virtual-folder', path: '/' };
    }

    if (!this.idCache.has(normalizedPath)) {
      const parentPath = normalizedPath.split('/').slice(0, -1).join('/') || '/';
      await this.readDirectory(parentPath);
    }

    const cached = this.idCache.get(normalizedPath);
    if (!cached) {
      throw new VfsNotFoundError(normalizedPath);
    }
    // LRU bump.
    this.idCache.delete(normalizedPath);
    this.idCache.set(normalizedPath, cached);
    return cached;
  }

  private getDirectoryContext(node: CachedNode): DirectoryContext {
    if (node.type === 'project') {
      return {
        scope: 'project',
        projectId: node.projectId || node.id,
      };
    }

    if (node.type === 'directory' && node.collection) {
      return {
        scope: node.scope || 'personal',
        projectId: node.projectId,
        groupId: node.id,
      };
    }

    if (node.type === 'file' && node.item) {
      return {
        scope: node.scope || 'personal',
        projectId: node.projectId,
        groupId: node.item.groupId ?? undefined,
      };
    }

    if (node.rootFolderId === 'personal') {
      return { scope: 'personal' };
    }

    throw new VfsUnsupportedError(`directory context for ${node.path}`, { path: node.path });
  }

  private ensureSameScope(source: CachedNode, target: CachedNode) {
    if ((source.scope || 'personal') !== (target.scope || 'personal')) {
      throw new VfsUnsupportedError('moving between personal and project libraries');
    }
    if ((source.projectId || '') !== (target.projectId || '')) {
      throw new VfsUnsupportedError('moving between different projects');
    }
  }

  private buildCollectionPath(parentPath: string, collection: RemoteVfsDirectoryEntry): string {
    const name = this.toDisplayName(getRemoteEntryDisplayName(collection), collection.id);
    return `${parentPath === '/' ? '' : parentPath}/${name}`;
  }

  private buildItemPath(parentPath: string, item: RemoteVfsFileEntry): string {
    const name = this.toDisplayName(getRemoteEntryDisplayName(item), item.id);
    return `${parentPath === '/' ? '' : parentPath}/${name}`;
  }

  private async listScopeDirectory(params: {
    parentPath: string;
    scope: RemoteVfsScope;
    projectId?: string;
    groupId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<VfsEntry[]> {
    const [collections, itemsResponse] = await Promise.all([
      fetchRemoteCollections({
        config: this.resolveConfig(),
        scope: params.scope,
        projectId: params.projectId,
        parentId: params.groupId,
        orphansOnly: !params.groupId,
        includeChildrenCount: true,
      }),
      fetchRemoteItems({
        config: this.resolveConfig(),
        scope: params.scope,
        projectId: params.projectId,
        groupId: params.groupId,
        orphansOnly: !params.groupId,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        limit: params.limit,
        offset: params.offset,
      }),
    ]);

    const listedEntries: ListedEntry[] = [];

    for (const collection of collections) {
      const path = this.buildCollectionPath(params.parentPath, collection);
      const entry = this.createCollectionEntry({
        collection,
        path,
        parentPath: params.parentPath,
        scope: params.scope,
        projectId: params.projectId,
      });
      listedEntries.push(this.toComparableEntry(entry));
    }

    for (const item of itemsResponse.items as RemoteVfsFileEntry[]) {
      const path = this.buildItemPath(params.parentPath, item);
      const entry = this.createItemEntry({
        item,
        path,
        parentPath: params.parentPath,
        scope: params.scope,
        projectId: params.projectId,
      });
      listedEntries.push(this.toComparableEntry(entry));
    }

    const sorted = this.sortEntries(listedEntries, params.sortBy, params.sortOrder);
    const paged = this.paginateEntries(sorted, params.limit, params.offset) as VfsEntry[] & {
      total?: number;
    };
    paged.total = sorted.length;
    return paged;
  }

  private async listAllVirtualItems(params: {
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<VfsEntry[]> {
    const config = this.resolveConfig();
    const projects = await fetchRemoteProjects({ config });

    const responses = await Promise.all([
      fetchRemoteItems({
        config,
        scope: 'personal',
        orphansOnly: true,
      }),
      ...projects.map((project) =>
        fetchRemoteItems({
          config,
          scope: 'project',
          projectId: project.id,
          orphansOnly: true,
        }),
      ),
    ]);

    const allItems: Array<{
      item: RemoteVfsFileEntry;
      scope: RemoteVfsScope;
      projectId?: string;
    }> = [];

    responses.forEach((response, index) => {
      if (index === 0) {
        (response.items as RemoteVfsFileEntry[]).forEach((item) => {
          allItems.push({ item, scope: 'personal' });
        });
        return;
      }

      const project = projects[index - 1]!;
      (response.items as RemoteVfsFileEntry[]).forEach((item) => {
        allItems.push({ item, scope: 'project', projectId: project.id });
      });
    });

    const listedEntries = allItems.map(({ item, scope, projectId }) => {
      const path = this.buildItemPath('/virtual-all', item);
      const entry = this.createItemEntry({
        item,
        path,
        parentPath: '/virtual-all',
        scope,
        projectId,
      });
      return this.toComparableEntry(entry);
    });

    const sorted = this.sortEntries(listedEntries, params.sortBy, params.sortOrder);
    const paged = this.paginateEntries(sorted, params.limit, params.offset) as VfsEntry[] & {
      total?: number;
    };
    paged.total = sorted.length;
    return paged;
  }

  private listContentItemMedia(itemPath: string, item: RemoteVfsFileEntry): VfsEntry[] {
    const entries: VfsEntry[] = [];

    if (item.media?.length) {
      item.media.forEach((media, index) => {
        const name = getRemoteMediaDisplayName({ entry: item, media, mediaIndex: index });
        const mediaPath = `${itemPath}/${name}`;
        const mediaId = getRemoteMediaId(media);
        this.setCache(mediaPath, {
          id: mediaId || media.id,
          type: 'media',
          path: mediaPath,
          scope: item.scope,
          projectId: item.projectId,
          item,
          media,
          mediaIndex: index,
        });
        entries.push({
          ...createRemoteMediaFsEntry({ item, media, mediaIndex: index }),
          name,
          path: mediaPath,
          parentPath: itemPath,
        } as VfsEntry);
      });
    }

    // Always show text content as a .txt file, even if empty
    const textName = `${getRemoteEntryDisplayName(item)}.txt`;
    const textPath = `${itemPath}/${textName}`;
    this.setCache(textPath, {
      id: item.id,
      type: 'media',
      path: textPath,
      scope: item.scope,
      projectId: item.projectId,
      item,
      mediaIndex: -1,
    });

    const blob = new Blob([item.text || ''], { type: 'text/plain' });
    entries.push({
      name: textName,
      kind: 'file',
      path: textPath,
      parentPath: itemPath,
      size: blob.size,
      lastModified: item.updatedAt ? new Date(item.updatedAt).getTime() : undefined,
      createdAt: item.createdAt ? new Date(item.createdAt).getTime() : undefined,
      adapterPayload: {
        type: 'media',
        remoteData: item,
      } as BloggerDogEntryPayload,
    } as VfsEntry);

    return entries;
  }

  async readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]> {
    throwIfAborted(options?.signal, path);
    const normalizedPath = this.normalizePath(path);

    if (normalizedPath === '/') {
      return [
        this.createVirtualRootEntry(
          'virtual-all',
          this.t ? this.t('fastcat.bloggerDog.allContent') : 'Все элементы',
        ),
        this.createVirtualRootEntry(
          'projects',
          this.t ? this.t('fastcat.bloggerDog.projectLibraries') : 'Проекты',
        ),
        this.createVirtualRootEntry(
          'personal',
          this.t ? this.t('fastcat.bloggerDog.personalLibrary') : 'Личная библиотека',
        ),
      ];
    }

    if (normalizedPath === '/projects') {
      const projects = await fetchRemoteProjects({ config: this.resolveConfig() });
      const listed = projects.map((project) =>
        this.toComparableEntry(this.createProjectEntry(project)),
      );
      const sorted = this.sortEntries(listed, options?.sortBy, options?.sortOrder);
      const paged = this.paginateEntries(sorted, options?.limit, options?.offset) as VfsEntry[] & {
        total?: number;
      };
      paged.total = sorted.length;
      return paged;
    }

    if (normalizedPath === '/virtual-all') {
      return await this.listAllVirtualItems(options ?? {});
    }

    if (normalizedPath === '/personal') {
      return await this.listScopeDirectory({
        parentPath: '/personal',
        scope: 'personal',
        sortBy: options?.sortBy,
        sortOrder: options?.sortOrder,
        limit: options?.limit,
        offset: options?.offset,
      });
    }

    const cached = await this.getIdForPath(normalizedPath);

    if (cached.type === 'project') {
      return await this.listScopeDirectory({
        parentPath: normalizedPath,
        scope: 'project',
        projectId: cached.projectId || cached.id,
        sortBy: options?.sortBy,
        sortOrder: options?.sortOrder,
        limit: options?.limit,
        offset: options?.offset,
      });
    }

    if (cached.type === 'directory' && cached.collection) {
      return await this.listScopeDirectory({
        parentPath: normalizedPath,
        scope: cached.scope || 'personal',
        projectId: cached.projectId,
        groupId: cached.id,
        sortBy: options?.sortBy,
        sortOrder: options?.sortOrder,
        limit: options?.limit,
        offset: options?.offset,
      });
    }

    if (cached.type === 'file' && cached.item) {
      const freshItem = await fetchRemoteItem({
        config: this.resolveConfig(),
        id: cached.id,
      });

      const refreshedItem: RemoteVfsFileEntry = {
        ...freshItem,
        path: normalizedPath,
        scope: cached.scope || freshItem.scope,
        projectId: cached.projectId || freshItem.projectId,
      };

      this.setCache(normalizedPath, {
        ...cached,
        item: refreshedItem,
      });

      return this.listContentItemMedia(normalizedPath, refreshedItem);
    }

    throw new VfsUnsupportedError(`directory listing for ${normalizedPath}`, {
      path: normalizedPath,
    });
  }

  async createDirectory(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      throw new VfsInvalidArgumentError('Invalid directory name', { path });
    }

    const parentPath = parts.length > 0 ? `/${parts.join('/')}` : '/';
    const parent = await this.getIdForPath(parentPath);

    if (
      parent.path === '/' ||
      parent.rootFolderId === 'projects' ||
      parent.rootFolderId === 'virtual-all'
    ) {
      throw new VfsConflictError(parentPath, `Cannot create collection in ${parentPath}`);
    }

    if (parent.type === 'file') {
      throw new VfsUnsupportedError('creating folders inside content items', { path });
    }

    const context = this.getDirectoryContext(parent);
    const collection = await createRemoteCollection({
      config: this.resolveConfig(),
      name,
      scope: context.scope,
      projectId: context.projectId,
      parentId: parent.type === 'directory' ? parent.id : undefined,
    });

    this.setCache(normalizedPath, {
      id: collection.id,
      type: 'directory',
      path: normalizedPath,
      scope: context.scope,
      projectId: context.projectId,
      parentId: collection.parentId ?? null,
      collection: {
        ...collection,
        path: normalizedPath,
        scope: context.scope,
        projectId: context.projectId,
      },
    });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((entry) => entry.name);
  }

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    throwIfAborted(options?.signal, path);
    const entry = await this.getIdForPath(path);

    if (entry.type !== 'media' || !entry.item) {
      throw new VfsUnsupportedError(`reading a non-media entry as a file: ${path}`, { path });
    }

    if (entry.mediaIndex === -1) {
      return new Blob([entry.item.text || ''], { type: 'text/plain' });
    }

    const downloadUrl = getRemoteFileDownloadUrl({
      baseUrl: this.resolveConfig().baseUrl,
      entry: entry.item,
      media: entry.media,
      mediaIndex: entry.mediaIndex ?? 0,
      mediaId: getRemoteMediaId(entry.media),
    });

    const config = this.resolveConfig();
    const requestHeaders =
      downloadUrl.startsWith(config.baseUrl) ||
      downloadUrl.startsWith(new URL(config.baseUrl).origin)
        ? { Authorization: `Bearer ${config.bearerToken}` }
        : undefined;

    const response = await fetch(downloadUrl, {
      signal: options?.signal,
      headers: requestHeaders,
    });
    if (!response.ok) {
      throw new Error(`Failed to download file from remote: ${response.status}`);
    }
    return await response.blob();
  }

  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, path);
    const normalizedPath = this.normalizePath(path);

    // Check if we are writing to a virtual text file of a content item
    const cached = this.idCache.get(normalizedPath);
    if (cached?.type === 'media' && cached.mediaIndex === -1 && cached.item) {
      let textContent: string;
      if (data instanceof Blob) {
        textContent = await data.text();
      } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
        textContent = new TextDecoder().decode(data);
      } else {
        textContent = data;
      }

      await updateRemoteItem({
        config: this.resolveConfig(),
        id: cached.item.id,
        text: textContent,
      });

      cached.item.text = textContent;
      this.clearCache(normalizedPath);
      this.revokeObjectUrl(normalizedPath);
      return;
    }

    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      throw new VfsInvalidArgumentError('Invalid file name', { path });
    }

    const parentPath = parts.length > 0 ? `/${parts.join('/')}` : '/';
    const parent = await this.getIdForPath(parentPath);

    if (
      parent.path === '/' ||
      parent.rootFolderId === 'projects' ||
      parent.rootFolderId === 'virtual-all'
    ) {
      throw new VfsConflictError(parentPath, `Cannot upload into ${parentPath}`);
    }

    const context = this.getDirectoryContext(parent);
    let fileToUpload: File;
    if (data instanceof Blob) {
      fileToUpload = new File([data], name, { type: data.type });
    } else if (data instanceof Uint8Array || ArrayBuffer.isView(data)) {
      fileToUpload = new File([data as BlobPart], name, { type: 'application/octet-stream' });
    } else {
      fileToUpload = new File([data], name, { type: 'text/plain' });
    }

    await uploadFileToRemote({
      config: this.resolveConfig(),
      file: fileToUpload,
      scope: context.scope,
      projectId: context.projectId,
      groupId: context.groupId,
      itemId: parent.type === 'file' ? parent.id : undefined,
      signal: options?.signal,
    });

    this.clearCache(parentPath);
    this.idCache.delete(normalizedPath);
    this.revokeObjectUrl(normalizedPath);
  }

  async deleteEntry(path: string, _recursive?: boolean): Promise<void> {
    const entry = await this.getIdForPath(path);
    const config = this.resolveConfig();

    if (entry.type === 'virtual-folder' || entry.type === 'project') {
      throw new VfsUnsupportedError('deleting virtual folders and projects', { path });
    }

    this.revokeObjectUrl(path);

    if (entry.type === 'directory') {
      await deleteRemoteCollection({ config, id: entry.id });
    } else if (entry.type === 'media') {
      if (entry.mediaIndex === -1 && entry.item) {
        await updateRemoteItem({
          config,
          id: entry.item.id,
          text: '',
        });
        entry.item.text = '';
      } else {
        await deleteRemoteMedia({ config, id: entry.id });
      }
    } else {
      await deleteRemoteItem({ config, id: entry.id });
    }

    this.clearCache(path);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    const normalizedSource = this.normalizePath(sourcePath);
    const normalizedTarget = this.normalizePath(targetPath);
    const source = await this.getIdForPath(normalizedSource);

    if (source.type === 'virtual-folder' || source.type === 'project') {
      throw new VfsUnsupportedError('moving virtual folders and projects', { path: sourcePath });
    }

    const targetParts = normalizedTarget.split('/').filter(Boolean);
    const newName = targetParts.pop();
    if (!newName) {
      throw new VfsInvalidArgumentError('Invalid target name', { path: targetPath });
    }

    const targetParentPath = targetParts.length > 0 ? `/${targetParts.join('/')}` : '/';
    const targetParent = await this.getIdForPath(targetParentPath);

    if (
      targetParent.path === '/' ||
      targetParent.rootFolderId === 'projects' ||
      targetParent.rootFolderId === 'virtual-all'
    ) {
      throw new VfsConflictError(targetParentPath, `Cannot move into ${targetParentPath}`);
    }

    this.ensureSameScope(source, targetParent);

    const config = this.resolveConfig();

    const sourceParentPath = normalizedSource.split('/').slice(0, -1).join('/') || '/';

    if (source.type === 'media' && source.mediaIndex === -1) {
      if (sourceParentPath !== targetParentPath) {
        throw new VfsUnsupportedError('moving text wrappers between content items', {
          path: sourcePath,
        });
      }

      const nextTitle = normalizeBloggerDogTextWrapperTitle(newName);
      if (!nextTitle) {
        throw new VfsInvalidArgumentError('Invalid target name', { path: targetPath });
      }

      await updateRemoteItem({
        config,
        id: source.item!.id,
        title: nextTitle,
      });

      const contentItemParentPath = sourceParentPath.split('/').slice(0, -1).join('/') || '/';
      this.clearCache(sourceParentPath);
      this.clearCache(contentItemParentPath);
      return;
    }

    if (source.type === 'directory') {
      const targetParentId = targetParent.type === 'directory' ? targetParent.id : null;
      await updateRemoteCollection({
        config,
        id: source.id,
        title: newName,
        parentId: targetParentId,
      });
    } else if (source.type === 'file') {
      const targetGroupId = targetParent.type === 'directory' ? targetParent.id : null;
      await updateRemoteItem({
        config,
        id: source.id,
        title: newName,
        groupId: targetGroupId,
      });
    } else {
      if (sourceParentPath !== targetParentPath) {
        throw new VfsUnsupportedError('moving media between content items', { path: sourcePath });
      }
      await renameRemoteMedia({
        config,
        id: source.id,
        name: newName,
      });
    }

    this.revokeObjectUrl(normalizedSource);
    this.clearCache(normalizedSource);
    this.clearCache(targetParentPath);
  }

  /**
   * Copies a single file. The implementation streams via readStream → writeStream
   * where the target supports it; the BloggerDog write path itself requires a
   * full multipart upload, so for now we fall back to read-into-Blob + upload.
   */
  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    const blob = await this.readFile(sourcePath, options);
    await this.writeFile(targetPath, blob, options);
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    await copyDirectoryTree(
      {
        readDirectory: (path) => this.readDirectory(path),
        createDirectory: (path) => this.createDirectory(path),
        copyFile: (source, target, copyOptions) => this.copyFile(source, target, copyOptions),
      },
      sourcePath,
      targetPath,
      options,
    );
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getIdForPath(path);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(path: string): Promise<VfsEntryMetadata | null> {
    let entry: CachedNode;
    try {
      entry = await this.getIdForPath(path);
    } catch {
      return null;
    }

    if (entry.type === 'media') {
      if (entry.mediaIndex === -1) {
        return {
          size: (entry.item?.text || '').length,
          lastModified: entry.item?.updatedAt ? new Date(entry.item.updatedAt).getTime() : 0,
          kind: 'file',
        };
      }
      const media = resolveMediaObject(entry.media);
      return {
        size: media?.sizeBytes ?? media?.size ?? 0,
        lastModified: media?.updated ? new Date(media.updated).getTime() : 0,
        kind: 'file',
      };
    }

    if (entry.type === 'file') {
      const firstMedia = resolveMediaObject(entry.item?.media?.[0]);
      return {
        size: firstMedia?.sizeBytes ?? firstMedia?.size ?? 0,
        lastModified: entry.item?.updatedAt ? new Date(entry.item.updatedAt).getTime() : 0,
        // Content items behave as directories in this VFS — their media list is
        // browsed via readDirectory. Keep the kind consistent with createItemEntry.
        kind: 'directory',
      };
    }

    if (entry.type === 'directory') {
      return {
        size: entry.collection?.itemsCount ?? 0,
        lastModified: entry.collection?.updatedAt
          ? new Date(entry.collection.updatedAt).getTime()
          : 0,
        kind: 'directory',
      };
    }

    return {
      size: 0,
      lastModified: entry.project?.updatedAt ? new Date(entry.project.updatedAt).getTime() : 0,
      kind: 'directory',
    };
  }

  async getObjectUrl(path: string): Promise<string> {
    const entry = await this.getIdForPath(path);

    if (entry.type !== 'media' || !entry.item) {
      throw new VfsUnsupportedError(`object URL for non-media path: ${path}`, { path });
    }

    const previous = this.objectUrlsByPath.get(path);
    if (previous) {
      URL.revokeObjectURL(previous);
      this.objectUrlsByPath.delete(path);
    }

    const blob =
      entry.mediaIndex === -1
        ? new Blob([entry.item.text || ''], { type: 'text/plain' })
        : await this.readFile(path);
    const url = URL.createObjectURL(blob);
    this.trackObjectUrl(path, url);
    return url;
  }

  async getFile(path: string): Promise<File | null> {
    const fileName = path.split('/').filter(Boolean).pop() || 'download';
    const blob = await this.readFile(path);
    return new File([blob], fileName, { type: blob.type });
  }

  async readStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.readFile(path, options);
    return blob.stream();
  }

  async writeStream(_path: string): Promise<WritableStream<Uint8Array>> {
    // BloggerDog requires a finalized multipart upload — implementing chunked
    // streaming is a separate piece of work. Until that exists, callers should
    // use writeFile with a Blob/Uint8Array instead.
    throw new VfsUnsupportedError('writeStream on BloggerDog VFS', { path: _path });
  }

  async writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void> {
    await this.writeFile(path, JSON.stringify(data, null, 2), options);
  }
}
