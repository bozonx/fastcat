import type { IFileSystemAdapter, VfsEntry } from './types';
import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';
import {
  createRemoteCollection,
  createRemoteMediaFsEntry,
  deleteRemoteCollection,
  deleteRemoteItem,
  deleteRemoteMedia,
  fetchRemoteCollections,
  fetchRemoteItems,
  fetchRemoteProjects,
  getRemoteEntryDisplayName,
  getRemoteFileDownloadUrl,
  getRemoteMediaDisplayName,
  renameRemoteMedia,
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
  media?: RemoteVfsMedia;
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

export class BloggerDogVfsAdapter implements IFileSystemAdapter {
  id = 'bloggerdog';

  private idCache = new Map<string, CachedNode>();

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

  private clearCache(path: string) {
    const normalizedPath = this.normalizePath(path);
    const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
    for (const key of [...this.idCache.keys()]) {
      if (key === normalizedPath || key.startsWith(prefix)) {
        this.idCache.delete(key);
      }
    }
  }

  private toDisplayName(name: string | undefined, fallback: string): string {
    const trimmed = name?.trim();
    return trimmed || fallback;
  }

  private createVirtualRootEntry(id: RootFolderId, name: string): VfsEntry {
    const path = id === 'virtual-all' ? '/virtual-all' : id === 'personal' ? '/personal' : '/projects';
    const cachedNode: CachedNode = {
      id,
      type: 'virtual-folder',
      path,
      rootFolderId: id,
    };
    this.idCache.set(path, cachedNode);

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
        } as any,
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
    this.idCache.set(path, {
      id: project.id,
      type: 'project',
      path,
      scope: 'project',
      projectId: project.id,
      project: entryWithPath,
    });

    return {
      ...toRemoteFsEntry(entryWithPath),
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
    this.idCache.set(params.path, {
      id: params.collection.id,
      type: 'directory',
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
      parentId: params.collection.parentId ?? null,
      collection: collectionWithPath,
    });

    return {
      ...toRemoteFsEntry(collectionWithPath),
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
    this.idCache.set(params.path, {
      id: params.item.id,
      type: 'file',
      path: params.path,
      scope: params.scope,
      projectId: params.projectId,
      parentId: params.item.groupId ?? null,
      item: itemWithPath,
    });

    const isSimpleFile = itemWithPath.media?.length === 1 && !itemWithPath.text?.trim();
    return {
      ...toRemoteFsEntry(itemWithPath),
      kind: isSimpleFile ? 'file' : 'directory',
      path: params.path,
      parentPath: params.parentPath,
      hasChildren: !isSimpleFile,
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
      throw new Error(`Path not found or not cached: ${normalizedPath}`);
    }
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

    throw new Error(`Unsupported remote directory context for path: ${node.path}`);
  }

  private ensureSameScope(source: CachedNode, target: CachedNode) {
    if ((source.scope || 'personal') !== (target.scope || 'personal')) {
      throw new Error('Moving between personal and project libraries is not supported');
    }
    if ((source.projectId || '') !== (target.projectId || '')) {
      throw new Error('Moving between different projects is not supported');
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
        includeChildrenCount: true,
      }),
      fetchRemoteItems({
        config: this.resolveConfig(),
        scope: params.scope,
        projectId: params.projectId,
        groupId: params.groupId,
        orphansOnly: !params.groupId,
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
        this.idCache.set(mediaPath, {
          id: media.id,
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

    if (item.text?.trim()) {
      const textName = `${getRemoteEntryDisplayName(item)}.txt`;
      const textPath = `${itemPath}/${textName}`;
      this.idCache.set(textPath, {
        id: item.id,
        type: 'media',
        path: textPath,
        scope: item.scope,
        projectId: item.projectId,
        item,
        mediaIndex: -1,
      });

      const blob = new Blob([item.text], { type: 'text/plain' });
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
    }

    return entries;
  }

  async readDirectory(
    path: string,
    options?: { sortBy?: string; sortOrder?: 'asc' | 'desc'; limit?: number; offset?: number },
  ): Promise<VfsEntry[]> {
    const normalizedPath = this.normalizePath(path);

    if (normalizedPath === '/') {
      return [
        this.createVirtualRootEntry(
          'virtual-all',
          this.t ? this.t('fastcat.bloggerDog.allContent', 'Все элементы') : 'Все элементы',
        ),
        this.createVirtualRootEntry(
          'projects',
          this.t ? this.t('fastcat.bloggerDog.projectLibraries', 'Проекты') : 'Проекты',
        ),
        this.createVirtualRootEntry(
          'personal',
          this.t ? this.t('fastcat.bloggerDog.personalLibrary', 'Личная библиотека') : 'Личная библиотека',
        ),
      ];
    }

    if (normalizedPath === '/projects') {
      const projects = await fetchRemoteProjects({ config: this.resolveConfig() });
      const listed = projects.map((project) => this.toComparableEntry(this.createProjectEntry(project)));
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
      return this.listContentItemMedia(normalizedPath, cached.item);
    }

    throw new Error(`Unsupported remote directory: ${normalizedPath}`);
  }

  async createDirectory(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      throw new Error('Invalid directory name');
    }

    const parentPath = `/${parts.join('/')}` || '/';
    const parent = await this.getIdForPath(parentPath);

    if (parent.path === '/' || parent.rootFolderId === 'projects' || parent.rootFolderId === 'virtual-all') {
      throw new Error(`Cannot create collection in ${parentPath}`);
    }

    const context = this.getDirectoryContext(parent);
    const collection = await createRemoteCollection({
      config: this.resolveConfig(),
      name,
      scope: context.scope,
      projectId: context.projectId,
      parentId: parent.type === 'directory' ? parent.id : undefined,
    });

    this.idCache.set(normalizedPath, {
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

  async readFile(path: string, options?: { signal?: AbortSignal }): Promise<Blob> {
    const entry = await this.getIdForPath(path);

    if (entry.type !== 'media' || !entry.item) {
      throw new Error(`Cannot download a collection or content item directly: ${path}`);
    }

    if (entry.mediaIndex === -1) {
      return new Blob([entry.item.text || ''], { type: 'text/plain' });
    }

    const downloadUrl = getRemoteFileDownloadUrl({
      baseUrl: this.resolveConfig().baseUrl,
      entry: entry.item,
      media: entry.media,
      mediaIndex: entry.mediaIndex ?? 0,
      mediaId: entry.media?.id,
    });

    const response = await fetch(downloadUrl, { signal: options?.signal });
    if (!response.ok) {
      throw new Error(`Failed to download file from remote: ${response.status}`);
    }
    return await response.blob();
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      throw new Error('Invalid file name');
    }

    const parentPath = `/${parts.join('/')}` || '/';
    const parent = await this.getIdForPath(parentPath);

    if (parent.path === '/' || parent.rootFolderId === 'projects' || parent.rootFolderId === 'virtual-all') {
      throw new Error(`Cannot upload into ${parentPath}`);
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
    });

    this.clearCache(parentPath);
    this.idCache.delete(normalizedPath);
  }

  async deleteEntry(path: string, _recursive?: boolean): Promise<void> {
    const entry = await this.getIdForPath(path);
    const config = this.resolveConfig();

    if (entry.type === 'virtual-folder' || entry.type === 'project') {
      throw new Error('Deleting virtual folders and projects is not supported');
    }

    if (entry.type === 'directory') {
      await deleteRemoteCollection({ config, id: entry.id });
    } else if (entry.type === 'media') {
      if (entry.mediaIndex === -1) {
        throw new Error('Deleting text body separately is not supported');
      }
      await deleteRemoteMedia({ config, id: entry.id });
    } else {
      await deleteRemoteItem({ config, id: entry.id });
    }

    this.clearCache(path);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    _options?: { signal?: AbortSignal },
  ): Promise<void> {
    const normalizedSource = this.normalizePath(sourcePath);
    const normalizedTarget = this.normalizePath(targetPath);
    const source = await this.getIdForPath(normalizedSource);

    if (source.type === 'virtual-folder' || source.type === 'project') {
      throw new Error('Moving virtual folders and projects is not supported');
    }

    const targetParts = normalizedTarget.split('/').filter(Boolean);
    const newName = targetParts.pop();
    if (!newName) {
      throw new Error('Invalid target name');
    }

    const targetParentPath = `/${targetParts.join('/')}` || '/';
    const targetParent = await this.getIdForPath(targetParentPath);

    if (targetParent.path === '/' || targetParent.rootFolderId === 'projects' || targetParent.rootFolderId === 'virtual-all') {
      throw new Error(`Cannot move into ${targetParentPath}`);
    }

    this.ensureSameScope(source, targetParent);

    const config = this.resolveConfig();

    if (source.type === 'directory') {
      const targetParentId =
        targetParent.type === 'directory'
          ? targetParent.id
          : targetParent.type === 'project' || targetParent.rootFolderId === 'personal'
            ? null
            : null;

      await updateRemoteCollection({
        config,
        id: source.id,
        title: newName,
        parentId: targetParentId,
      });
    } else if (source.type === 'file') {
      const targetGroupId =
        targetParent.type === 'directory'
          ? targetParent.id
          : targetParent.type === 'project' || targetParent.rootFolderId === 'personal'
            ? null
            : null;

      await updateRemoteItem({
        config,
        id: source.id,
        title: newName,
        groupId: targetGroupId,
      });
    } else {
      const sourceParentPath = normalizedSource.split('/').slice(0, -1).join('/') || '/';
      if (sourceParentPath !== targetParentPath) {
        throw new Error('Moving media between content items is not supported');
      }
      await renameRemoteMedia({
        config,
        id: source.id,
        name: newName,
      });
    }

    this.clearCache(normalizedSource);
    this.clearCache(targetParentPath);
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
        await this.copyDirectoryRecursive(entry.path, nextTargetPath, depth + 1, options);
      } else {
        await this.copyFile(entry.path, nextTargetPath, options);
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
      const now = Date.now();

      if (entry.type === 'media') {
        if (entry.mediaIndex === -1) {
          return {
            size: (entry.item?.text || '').length,
            lastModified: entry.item?.updatedAt ? new Date(entry.item.updatedAt).getTime() : now,
            kind: 'file',
          };
        }

        return {
          size: entry.media?.size ?? 0,
          lastModified: entry.media?.updated ? new Date(entry.media.updated).getTime() : now,
          kind: 'file',
        };
      }

      if (entry.type === 'file') {
        return {
          size: entry.item?.media?.[0]?.size ?? 0,
          lastModified: entry.item?.updatedAt ? new Date(entry.item.updatedAt).getTime() : now,
          kind: 'directory',
        };
      }

      if (entry.type === 'directory') {
        return {
          size: entry.collection?.itemsCount ?? 0,
          lastModified: entry.collection?.updatedAt
            ? new Date(entry.collection.updatedAt).getTime()
            : now,
          kind: 'directory',
        };
      }

      return {
        size: 0,
        lastModified: entry.project?.updatedAt ? new Date(entry.project.updatedAt).getTime() : now,
        kind: 'directory',
      };
    } catch {
      return null;
    }
  }

  async getObjectUrl(path: string): Promise<string> {
    const entry = await this.getIdForPath(path);

    if (entry.type !== 'media' || !entry.item) {
      throw new Error(`Path is not a valid media file: ${path}`);
    }

    if (entry.mediaIndex === -1) {
      return URL.createObjectURL(new Blob([entry.item.text || ''], { type: 'text/plain' }));
    }

    return getRemoteFileDownloadUrl({
      baseUrl: this.resolveConfig().baseUrl,
      entry: entry.item,
      media: entry.media,
      mediaIndex: entry.mediaIndex ?? 0,
      mediaId: entry.media?.id,
    });
  }

  async getFile(path: string): Promise<File | null> {
    const fileName = path.split('/').filter(Boolean).pop() || 'download';
    const blob = await this.readFile(path);
    return new File([blob], fileName, { type: blob.type });
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const blob = await this.readFile(path);
    return blob.stream();
  }

  async writeStream(_path: string): Promise<WritableStream<Uint8Array>> {
    throw new Error('writeStream not supported on remote');
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, JSON.stringify(data, null, 2));
  }
}
