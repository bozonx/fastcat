import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { BdPagination } from '~/types/bloggerdog';
import type {
  RemoteVfsDirectoryEntry,
  RemoteVfsEntry,
  RemoteVfsFileEntry,
  RemoteVfsMedia,
  RemoteVfsScope,
} from '~/types/remote-vfs';
import { useWorkspaceStore } from './workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  createRemoteCollection,
  createRemoteItem,
  deleteRemoteCollection,
  deleteRemoteItem,
  fetchRemoteCollections,
  fetchRemoteItems,
  getRemoteThumbnailUrl,
  renameRemoteCollection,
  renameRemoteItem,
  type RemoteVfsClientConfig,
} from '~/utils/remote-vfs';

export const useBloggerDogStore = defineStore('bloggerDog', () => {
  const workspaceStore = useWorkspaceStore();

  const entries = ref<RemoteVfsEntry[]>([]);
  const totalEntries = ref(0);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const pagination = ref<BdPagination>({
    total: 0,
    limit: 50,
    offset: 0,
  });

  const config = computed((): RemoteVfsClientConfig | null => {
    try {
      const bdUrl = useRuntimeConfig().public.bloggerDogApiUrl;
      const accUrl = useRuntimeConfig().public.fastcatAccountApiUrl;

      const resolved = resolveExternalServiceConfig({
        service: 'files',
        integrations: workspaceStore.userSettings.integrations,
        bloggerDogApiUrl: typeof bdUrl === 'string' ? bdUrl : '',
        fastcatAccountApiUrl: typeof accUrl === 'string' ? accUrl : '',
      });

      if (!resolved) return null;
      return { baseUrl: resolved.baseUrl, bearerToken: resolved.bearerToken };
    } catch {
      return null;
    }
  });

  async function loadEntries(
    params: {
      scope?: RemoteVfsScope;
      projectId?: string;
      groupId?: string;
      orphansOnly?: boolean;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    if (!config.value) return;

    isLoading.value = true;
    error.value = null;

    try {
      const scope = params.scope ?? 'personal';
      const [collections, items] = await Promise.all([
        fetchRemoteCollections({
          config: config.value,
          scope,
          projectId: params.projectId,
          parentId: params.groupId,
          includeChildrenCount: true,
        }),
        fetchRemoteItems({
          config: config.value,
          scope,
          projectId: params.projectId,
          groupId: params.groupId,
          orphansOnly: params.orphansOnly,
          limit: params.limit ?? pagination.value.limit,
          offset: params.offset ?? pagination.value.offset,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        }),
      ]);

      entries.value = [...collections, ...(items.items as RemoteVfsFileEntry[])];
      totalEntries.value = collections.length + (items.total ?? items.items.length);
      pagination.value = {
        total: totalEntries.value,
        limit: params.limit ?? pagination.value.limit,
        offset: params.offset ?? pagination.value.offset,
      };
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to load entries';
      console.error('[BloggerDogStore] loadEntries error:', e);
    } finally {
      isLoading.value = false;
    }
  }

  function getThumbnailUrl(entry: RemoteVfsEntry): string | null {
    if (entry.type !== 'file' || !entry.media?.length || !config.value) return null;

    const media = entry.media.find((candidate: RemoteVfsMedia) => candidate.thumbnailUrl) || entry.media[0];
    if (!media) return null;

    return getRemoteThumbnailUrl({
      baseUrl: config.value.baseUrl,
      media,
    });
  }

  async function createCollection(params: {
    name: string;
    scope: RemoteVfsScope;
    projectId?: string;
    parentId?: string;
  }) {
    if (!config.value) return;
    return await createRemoteCollection({
      config: config.value,
      name: params.name,
      scope: params.scope,
      projectId: params.projectId,
      parentId: params.parentId,
    });
  }

  async function createItem(params: {
    title?: string;
    text?: string;
    scope?: RemoteVfsScope;
    projectId?: string;
    groupId?: string;
    tags?: string[];
    note?: string;
  }) {
    if (!config.value) return;
    return await createRemoteItem({
      config: config.value,
      ...params,
    });
  }

  async function renameEntry(id: string, type: 'file' | 'directory', name: string) {
    if (!config.value) return;
    if (type === 'directory') {
      await renameRemoteCollection({ config: config.value, id, name });
    } else {
      await renameRemoteItem({ config: config.value, id, name });
    }
  }

  async function deleteEntry(id: string, type: 'file' | 'directory') {
    if (!config.value) return;
    if (type === 'directory') {
      await deleteRemoteCollection({ config: config.value, id });
    } else {
      await deleteRemoteItem({ config: config.value, id });
    }
  }

  return {
    entries,
    totalEntries,
    isLoading,
    error,
    pagination,
    config,
    loadEntries,
    getThumbnailUrl,
    createCollection,
    createItem,
    renameEntry,
    deleteEntry,
  };
});
