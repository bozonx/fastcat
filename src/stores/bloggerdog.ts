import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { BdPagination } from '~/types/bloggerdog';
import type { RemoteVfsEntry, RemoteVfsMedia } from '~/types/remote-vfs';
import { useWorkspaceStore } from './workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  fetchRemoteVfsList,
  createRemoteCollection,
  deleteRemoteCollection,
  deleteRemoteItem,
  renameRemoteCollection,
  renameRemoteItem,
  getRemoteThumbnailUrl,
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
      path?: string;
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
      const response = await fetchRemoteVfsList({
        config: config.value,
        path: params.path || '/',
        limit: params.limit ?? pagination.value.limit,
        offset: params.offset ?? pagination.value.offset,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      });

      entries.value = response.items;
      totalEntries.value = response.total ?? response.items.length;

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
    if (entry.type !== 'file' || !('media' in entry) || !entry.media?.length) return null;

    const media = entry.media.find((m: RemoteVfsMedia) => m.thumbnailUrl) || entry.media[0];
    if (!media || !config.value) return null;

    return getRemoteThumbnailUrl({
      baseUrl: config.value.baseUrl,
      media,
    });
  }

  async function createCollection(name: string, parentId?: string, projectId?: string) {
    if (!config.value) return;
    return await createRemoteCollection({
      config: config.value,
      name,
      parentId,
      projectId,
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
    renameEntry,
    deleteEntry,
  };
});
